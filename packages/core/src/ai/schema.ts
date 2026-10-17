/** 構造化出力の要件: すべての object に additionalProperties: false を明示する（再帰） */
export function strictSchema(schema: object): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const o = { ...(node as Record<string, unknown>) };
      const types = Array.isArray(o.type) ? (o.type as string[]) : [o.type as string];
      if (types.includes('object') && o.properties) o.additionalProperties = false;
      for (const k of ['properties', 'items', 'anyOf', 'oneOf', 'allOf']) if (o[k] !== undefined) o[k] = walk(o[k]);
      if (o.properties && typeof o.properties === 'object') {
        o.properties = Object.fromEntries(Object.entries(o.properties as Record<string, unknown>).map(([k, v]) => [k, walk(v)]));
      }
      return o;
    }
    return node;
  };
  return walk(schema) as Record<string, unknown>;
}
