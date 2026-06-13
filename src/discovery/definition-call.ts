import ts from "typescript";

/**
 * Finds the object literal expression passed to defineAgent({ ... }) or defineTool({ ... })
 * when it is part of a default export.
 * 
 * Supported patterns:
 * - export default defineAgent({ ... })
 * - export default defineAgent<TInput, TOutput>({ ... })
 */
export function findDefaultDefineCall(
  sourceFile: ts.SourceFile,
  functionName: "defineAgent" | "defineTool"
): ts.ObjectLiteralExpression | undefined {
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      // export default ...
      let expression = statement.expression;

      // Handle defineAgent({ ... })
      if (ts.isCallExpression(expression)) {
        if (isCallOf(expression, functionName)) {
          const firstArg = expression.arguments[0];
          if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
            return firstArg;
          }
        }
      }
    }
  }

  return undefined;
}

function isCallOf(node: ts.CallExpression, name: string): boolean {
  const expression = node.expression;
  
  // simple call: functionName(...)
  if (ts.isIdentifier(expression) && expression.text === name) {
    return true;
  }

  // TODO: Support namespaced calls if needed, e.g., openflow.defineAgent(...)
  
  return false;
}
