import { A2UI_CATALOG_ID, type A2uiMessage } from "../../shared/a2ui-policy.js";

export const demoSurfaceId = "monitor-demo";
export const demoActions = ["monitor.submit", "monitor.cancel"];
export function demoMessages(): A2uiMessage[] {
  return [
    {
      version: "v0.9",
      createSurface: { surfaceId: demoSurfaceId, catalogId: A2UI_CATALOG_ID },
    },
    {
      version: "v0.9",
      updateDataModel: {
        surfaceId: demoSurfaceId,
        path: "/",
        value: {
          name: "资源监控",
          server: ["host-a"],
          metrics: ["cpu"],
          notes: "",
          status: "选择服务器和指标，创建一个监控任务。",
        },
      },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: demoSurfaceId,
        components: [
          {
            id: "root",
            component: "Column",
            children: [
              "title",
              "status",
              "details",
              "metrics",
              "notes",
              "actions",
            ],
          },
          {
            id: "title",
            component: "Text",
            text: "创建监控任务",
            variant: "h3",
          },
          { id: "status", component: "Text", text: { path: "/status" } },
          { id: "details", component: "Row", children: ["name", "server"] },
          {
            id: "name",
            component: "TextField",
            label: "任务名称",
            value: { path: "/name" },
          },
          {
            id: "server",
            component: "ChoicePicker",
            label: "服务器",
            value: { path: "/server" },
            options: [
              { label: "host-a", value: "host-a" },
              { label: "host-b", value: "host-b" },
            ],
          },
          {
            id: "metrics",
            component: "ChoicePicker",
            label: "监控指标",
            variant: "multipleSelection",
            value: { path: "/metrics" },
            options: [
              { label: "CPU", value: "cpu" },
              { label: "内存", value: "memory" },
              { label: "磁盘", value: "disk" },
            ],
          },
          {
            id: "notes",
            component: "TextField",
            label: "备注",
            variant: "longText",
            value: { path: "/notes" },
          },
          { id: "actions", component: "Row", children: ["submit", "cancel"] },
          {
            id: "submit",
            component: "Button",
            child: "submit-label",
            variant: "primary",
            action: {
              event: {
                name: "monitor.submit",
                context: {
                  name: { path: "/name" },
                  server: { path: "/server" },
                  metrics: { path: "/metrics" },
                  notes: { path: "/notes" },
                },
              },
            },
          },
          { id: "submit-label", component: "Text", text: "创建任务" },
          {
            id: "cancel",
            component: "Button",
            child: "cancel-label",
            action: { event: { name: "monitor.cancel", context: {} } },
          },
          { id: "cancel-label", component: "Text", text: "取消" },
        ],
      },
    },
  ];
}
