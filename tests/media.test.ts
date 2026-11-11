import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { database } from "../server/db.js";
import { artifactStore } from "../server/artifacts.js";
import { mediaStore, markdownImages } from "../server/media.js";
import {
  publicImageAddress,
  publicImageUrl,
  imageExtension,
} from "../server/public-images.js";
import { publicItem } from "../server/view.js";
import { AgentEvents } from "../server/ag-ui.js";
import { A2uiRuntime } from "../shared/a2ui-runtime.js";
import { createA2uiSchemaCatalog } from "../shared/a2ui-catalog.js";
import { encodeA2ui } from "../shared/a2ui-policy.js";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw1cAAAAASUVORK5CYII=",
  "base64",
);
const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), "newbot-media-")),
    root = join(dir, "workspace");
  mkdirSync(root);
  const db = database(dir);
  db.addThread("t", "mock");
  db.addThread("other", "mock");
  const artifacts = artifactStore(dir, root, db);
  const media = mediaStore(db, artifacts, async (url) => {
    assert.equal(url, "https://public.example/image.png");
    return png;
  });
  return {
    dir,
    root,
    db,
    artifacts,
    media,
    async close() {
      await media.close();
      await artifacts.close();
      db.raw.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
};
test("public image policy rejects local, mapped, reserved IPs, credentials, unsafe schemes and type masquerading", () => {
  for (const ip of [
    "127.0.0.1",
    "10.2.3.4",
    "169.254.169.254",
    "192.168.1.1",
    "100.64.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "::1",
    "::ffff:8.8.8.8",
    "fc00::1",
    "2001:db8::1",
    "2002:7f00:1::",
  ])
    assert.equal(publicImageAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
    assert.equal(publicImageAddress(ip), true, ip);
  for (const url of [
    "http://example.com",
    "file:///etc/passwd",
    "https://u:p@example.com/x",
    "https://127.0.0.1/x",
    "https://example.com:444/x",
  ])
    assert.throws(() => publicImageUrl(url));
  assert.throws(() => imageExtension(Buffer.from('<svg onload="alert(1)">')));
  assert.equal(imageExtension(png), ".png");
});
test("markdown image discovery respects syntax and reference images, excluding code examples", () => {
  assert.deepEqual(
    markdownImages(
      "![a](img.png)\n![b][ref]\n\n[ref]: https://public.example/image.png\n```md\n![fake](secret.png)\n```",
    ),
    [
      { url: "img.png", alt: "a" },
      { url: "https://public.example/image.png", alt: "b" },
    ],
  );
});
test("live markdown, native generation, MCP and function images share authenticated snapshots; history never recaptures files", async () => {
  const c = setup();
  try {
    writeFileSync(join(c.root, "plot.png"), png);
    const native = [
      {
        id: "markdown",
        type: "agentMessage",
        text: "![local](plot.png) ![web](https://public.example/image.png)",
      },
      {
        id: "mcp",
        type: "mcpToolCall",
        status: "completed",
        result: {
          content: [
            {
              type: "image",
              data: png.toString("base64"),
              mimeType: "image/png",
            },
          ],
        },
      },
      {
        id: "generate",
        type: "imageGeneration",
        status: "completed",
        result: png.toString("base64"),
      },
      {
        id: "file",
        type: "imageGeneration",
        status: "completed",
        savedPath: join(c.root, "plot.png"),
      },
      {
        id: "function",
        type: "functionCallOutput",
        output: [
          {
            type: "input_image",
            image_url: `data:image/png;base64,${png.toString("base64")}`,
          },
        ],
      },
      {
        id: "opaque",
        type: "imageGeneration",
        status: "completed",
        fileId: "provider-file",
      },
    ];
    for (const item of native) c.media.completed("t", "r", item, () => {});
    await c.media.close();
    const thread = c.media.decorate({
      id: "t",
      turns: [{ id: "r", status: "completed", items: native }],
    });
    const refs = thread.turns[0].items.flatMap((i) => i.media || []);
    assert.equal(refs.filter((r) => r.state === "ready").length, 6);
    assert.equal(refs.filter((r) => r.state === "failed").length, 1);
    for (const ref of refs.filter((r) => r.state === "ready")) {
      assert.match(ref.url!, /^\/api\/artifacts\//);
      assert.deepEqual((await c.artifacts.read(ref.artifactId!)).data, png);
    }
    writeFileSync(join(c.root, "plot.png"), "changed");
    const restart = mediaStore(c.db, c.artifacts);
    const recovered = restart.decorate(structuredClone(thread));
    assert.deepEqual(
      recovered.turns[0].items[0].media,
      thread.turns[0].items[0].media,
    );
    const historical = restart.decorate({
      id: "t",
      turns: [
        {
          id: "old",
          status: "completed",
          items: [
            {
              id: "never-captured",
              type: "agentMessage",
              text: "![old](plot.png)",
            },
          ],
        },
      ],
    });
    assert.equal(historical.turns[0].items[0].media, undefined);
    const count = c.db.raw
      .prepare("SELECT count(*) n FROM message_media")
      .get()!.n;
    restart.completed("t", "r", native[0], () => {});
    await restart.close();
    assert.equal(
      c.db.raw.prepare("SELECT count(*) n FROM message_media").get()!.n,
      count,
    );
    const projection = publicItem(native[1] as any);
    assert.doesNotMatch(JSON.stringify(projection), /iVBOR/);
    const events = new AgentEvents();
    const sent: any[] = [];
    events.on("event", (e) => sent.push(e));
    events.notification({
      method: "item/completed",
      params: { threadId: "t", turnId: "r", item: native[1] },
    } as any);
    assert.doesNotMatch(JSON.stringify(sent), /iVBOR/);
  } finally {
    await c.close();
  }
});
test("image registration rejects links, traversal, foreign references and preserves per-resource failures", async () => {
  const c = setup();
  try {
    writeFileSync(join(c.root, "ok.png"), png);
    symlinkSync(join(c.root, "ok.png"), join(c.root, "link.png"));
    c.media.completed(
      "t",
      "r",
      {
        id: "x",
        type: "agentMessage",
        text: "![ok](ok.png) ![link](link.png) ![escape](../outside.png)",
      },
      () => {},
    );
    await c.media.close();
    const refs = c.media.decorateItem("t", "r", {
      id: "x",
      type: "agentMessage",
    }).media!;
    assert.deepEqual(
      refs.map((r) => r.state),
      ["ready", "failed", "failed"],
    );
    const other = mediaStore(c.db, c.artifacts);
    await assert.rejects(
      other.resolveImage("other", "r", "x", refs[0].url!, "foreign"),
    );
    await other.close();
  } finally {
    await c.close();
  }
});
test("v2 cards, charts and links use a versioned catalog; legacy forms cannot accept new components", () => {
  const messages: any[] = [
    {
      version: "v0.9",
      createSurface: { surfaceId: "demo", catalogId: "newbot:ui/v2" },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "demo",
        components: [
          {
            id: "root",
            component: "Column",
            children: ["metric", "chart", "source"],
          },
          { id: "metric", component: "Metric", label: "CPU", value: "12%" },
          {
            id: "chart",
            component: "Chart",
            title: "Observed usage",
            kind: "bar",
            labels: ["A", "B"],
            series: [{ name: "CPU", values: [12, 24] }],
          },
          {
            id: "source",
            component: "SourceLink",
            label: "source",
            url: "https://example.com",
          },
        ],
      },
    },
  ];
  const runtime = new A2uiRuntime(createA2uiSchemaCatalog("newbot:ui/v2"), {
    surfaceId: "demo",
    allowedActions: [],
    onAction: () => {},
  });
  runtime.apply(encodeA2ui(messages));
  assert.equal(
    (runtime.snapshot()[0] as any).createSurface.catalogId,
    "newbot:ui/v2",
  );
  const legacy = new A2uiRuntime(createA2uiSchemaCatalog(), {
    surfaceId: "demo",
    allowedActions: [],
    onAction: () => {},
  });
  assert.throws(() => legacy.apply(encodeA2ui(messages)));
  const bad = structuredClone(messages);
  bad[1].updateComponents.components[2].series[0].values = [1];
  const r = new A2uiRuntime(createA2uiSchemaCatalog("newbot:ui/v2"), {
    surfaceId: "demo",
    allowedActions: [],
    onAction: () => {},
  });
  assert.throws(() => r.apply(encodeA2ui(bad)));
  r.dispose();
  legacy.dispose();
  runtime.dispose();
});

test("HTTPS redirects revalidate DNS, pin the socket and send no ambient credentials", async () => {
  const { EventEmitter } = await import("node:events");
  const { Readable } = await import("node:stream");
  const { fetchPublicImage } = await import("../server/public-images.js");
  const seen: any[] = [];
  let requestCount = 0;
  const network: any = {
    lookup: async (host: string) => [
      {
        address: host === "private.example" ? "127.0.0.1" : "8.8.8.8",
        family: 4,
      },
    ],
    request: (url: URL, options: any, callback: any) => {
      seen.push({ url: url.href, headers: options.headers });
      requestCount++;
      options.lookup(
        url.hostname,
        { all: true },
        (error: any, addresses: any) => {
          assert.equal(error, null);
          assert.deepEqual(addresses, [{ address: "8.8.8.8", family: 4 }]);
        },
      );
      const req = new EventEmitter() as any;
      req.end = () => {
        const response = Readable.from([png]) as any;
        response.statusCode = 302;
        response.headers = { location: "https://private.example/secret" };
        callback(response);
      };
      return req;
    },
  };
  await assert.rejects(
    fetchPublicImage("https://public.example/image", network),
  );
  assert.equal(requestCount, 1);
  assert.deepEqual(Object.keys(seen[0].headers).sort(), [
    "Accept",
    "User-Agent",
  ]);
});
