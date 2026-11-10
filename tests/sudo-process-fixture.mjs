// Synthetic consumer process. Never used by production launch.
const [prompt, mode = "success", marker] = process.argv.slice(2);
const fs = await import("node:fs");
const secret = "test sudo 私密 password";
if (mode === "nopass") {
  process.stdout.write("0\n");
  process.exit(0);
}
if (mode === "wronguid") {
  process.stdout.write("1000\n");
  process.exit(0);
}
if (mode === "hang") {
  setInterval(() => {}, 1000);
} else {
  process.stderr.write(mode === "lecture" ? "Local sudo policy notice\n" : "");
  process.stderr.write(prompt.slice(0, 10));
  setTimeout(() => process.stderr.write(prompt.slice(10)), 5);
  let input = Buffer.alloc(0);
  process.stdin.on("data", (part) => {
    input = Buffer.concat([input, part]);
  });
  process.stdin.on("end", () => {
    if (marker)
      fs.writeFileSync(
        marker,
        JSON.stringify({
          correct: input.toString() === secret + "\n",
          count: input.filter((v) => v === 10).length,
        }),
      );
    if (mode === "after") {
      setInterval(() => {}, 1000);
      return;
    }
    if (mode === "echo") {
      process.stdout.write(input);
      process.stderr.write(input);
    }
    if (mode === "reprompt") {
      process.stderr.write(prompt);
      setInterval(() => {}, 1000);
      return;
    }
    if (mode === "overflow") process.stderr.write(Buffer.alloc(10000, 65));
    const ok = input.toString() === secret + "\n";
    input.fill(0);
    process.stdout.write("0\n");
    process.exitCode = ok ? 0 : 1;
  });
}
