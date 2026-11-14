import { PersonIcon, PreferencesIcon } from "./SettingsIcons";
import { PluginIcon, SearchIcon as Search, SkillDocumentIcon } from "./ReferenceIcons";
export { PluginIcon, NewChatIcon, SearchIcon } from "./ReferenceIcons";
import { forwardRef } from "react";
import {
  Store,
  Plug,
  Import,
  BookOpen,
  UsersRound,
  Server,
  Cpu,
  Terminal,
  FilePenLine,
  ListChecks,
  Image,
  Wand,
  Clock3,
  ScanEye,
  AlignLeft,
  Wrench,
  MessageCircle,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

// Functional identity is shared by navigation, catalog, selection and execution.
// Never infer an icon from a user-editable name or an opaque tool identifier.
function functionalIcon(name: string, Icon: LucideIcon): LucideIcon {
  const Component = forwardRef<SVGSVGElement, LucideProps>((props, ref) => (
    <Icon
      {...props}
      ref={ref}
      strokeWidth={2}
      aria-hidden="true"
      className={`app-icon ${props.className || ""}`}
      data-icon={name}
    />
  ));
  Component.displayName = `${name}Icon`;
  return Component;
}
export const SkillIcon = SkillDocumentIcon;
export const ExpertIcon = functionalIcon("expert", PersonIcon);
export const ConnectionIcon = functionalIcon("connection", Plug);
export const StoreIcon = functionalIcon("store", Store);
export const ImportIcon = functionalIcon("import", Import);
export const GatewayIcon = functionalIcon("gateway", PreferencesIcon);
export const processIcons: Record<string, LucideIcon> = {
  agentMessage: functionalIcon("commentary", MessageCircle),
  commandExecution: functionalIcon("command", Terminal),
  fileChange: functionalIcon("file-change", FilePenLine),
  mcpToolCall: PluginIcon,
  dynamicToolCall: PluginIcon,
  webSearch: functionalIcon("search", Search),
  plan: functionalIcon("plan", ListChecks),
  imageView: functionalIcon("image-view", Image),
  imageGeneration: functionalIcon("image-generation", Wand),
  collabAgentToolCall: ExpertIcon,
  subAgentActivity: ExpertIcon,
  sleep: functionalIcon("wait", Clock3),
  enteredReviewMode: functionalIcon("review", ScanEye),
  exitedReviewMode: functionalIcon("review", ScanEye),
  contextCompaction: functionalIcon("context", AlignLeft),
  hookPrompt: PluginIcon,
  functionCallOutput: functionalIcon("tool-result", MessageCircle),
};
export const ToolIcon = functionalIcon("tool", Wrench);
