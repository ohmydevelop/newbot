import type { Rpc } from "../../shared/types.js";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
export type RunnerStart = {
  binary: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
};
/** Private local boundary, not a public arbitrary-RPC endpoint.
 * The control plane owns configuration and request authorization. The transport
 * owns native process IO. Remote durable command receipts are a separate layer.
 */
export interface RunnerTransport {
  child?: ChildProcessWithoutNullStreams;
  version(spec: Omit<RunnerStart, "args">): Promise<string>;
  start(
    spec: RunnerStart,
    handlers: {
      message: (message: Rpc) => void;
      offline: (reason: string) => void;
      closed: () => void;
    },
  ): void;
  send(message: Rpc): void;
  stop(): void;
  stopAndWait(): Promise<void>;
}
