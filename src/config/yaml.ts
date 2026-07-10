import { parseDocument, LineCounter, YAMLMap } from "yaml";
import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";

export function parseConfigYaml(content: string, sourcePath: string): unknown {
  const lineCounter = new LineCounter();
  const doc = parseDocument(content, { lineCounter, uniqueKeys: true });

  // 1. Inspect top-level map and providerAliases pairs in source order
  if (doc.contents && doc.contents instanceof YAMLMap) {
    const providerAliasesPair = doc.contents.items.find(
      (pair: any) => pair.key && (pair.key as any).value === "providerAliases"
    );

    if (providerAliasesPair && providerAliasesPair.value && providerAliasesPair.value instanceof YAMLMap) {
      const seenAliases = new Set<string>();
      for (const pair of providerAliasesPair.value.items) {
        if (pair.key && typeof (pair.key as any).value === "string") {
          const aliasName = (pair.key as any).value;
          if (seenAliases.has(aliasName)) {
            const offset = pair.key.range ? pair.key.range[0] : undefined;
            let line = undefined;
            let column = undefined;
            if (offset !== undefined) {
              const pos = lineCounter.linePos(offset);
              if (pos) {
                line = pos.line;
                column = pos.col;
              }
            }

            const errorMsg = `Duplicate provider alias definition '${aliasName}' detected in ${sourcePath}` +
              (line !== undefined ? ` at line ${line}, column ${column}` : "");

            const err = new OpenDynamicWorkflowError(
              ErrorCode.PROVIDER_ALIAS_DUPLICATE_DEFINITION as any,
              errorMsg
            );
            (err as any).alias = aliasName;
            (err as any).path = `providerAliases.${aliasName}`;
            (err as any).sourcePath = sourcePath;
            (err as any).line = line;
            (err as any).column = column;
            throw err;
          }
          seenAliases.add(aliasName);
        }
      }
    }
  }

  // 2. Check doc.errors for remaining duplicate keys or malformed YAML
  if (doc.errors && doc.errors.length > 0) {
    const errorMessages = doc.errors.map((err: any) => {
      if (err.message) {
        const firstLine = err.message.split("\n")[0].replace(/:$/, "").trim();
        return firstLine;
      }
      return String(err);
    });

    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      `Invalid YAML in config file: ${sourcePath}. ${errorMessages.join("; ")}`
    );
  }

  return doc.toJS({ mapAsMap: false });
}
