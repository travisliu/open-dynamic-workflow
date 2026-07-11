import { defineTool } from "./define-tool.js";

export interface ToolRuntimeApi {
  readonly defineTool: typeof defineTool;
}

export const activeToolRuntimeApi: ToolRuntimeApi = Object.freeze({ defineTool });
