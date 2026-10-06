import { ethereum } from "@graphprotocol/graph-ts/chain/ethereum";

function valueToString(value: ethereum.Value): string {
  if (value.kind == ethereum.ValueKind.ADDRESS) return value.toAddress().toHexString();
  if (value.kind == ethereum.ValueKind.BOOL) return value.toBoolean() ? "true" : "false";
  if (value.kind == ethereum.ValueKind.STRING) return value.toString();
  if (value.kind == ethereum.ValueKind.INT || value.kind == ethereum.ValueKind.UINT)
    return value.toBigInt().toString();
  if (value.kind == ethereum.ValueKind.BYTES || value.kind == ethereum.ValueKind.FIXED_BYTES)
    return value.toBytes().toHexString();
  if (value.kind == ethereum.ValueKind.ARRAY || value.kind == ethereum.ValueKind.FIXED_ARRAY) {
    const items = value.toArray();
    const parts = new Array<string>(items.length);
    for (let i = 0; i < items.length; i++) parts[i] = valueToString(items[i]);
    return "[" + parts.join(", ") + "]";
  }
  return "<unknown>";
}

export function stringifyParameters(event: ethereum.Event): string {
  // Plain loop, no Array#map closure: the closure compiled to a `call_indirect`
  // whose table slot the graph-node runtime never initialised, so the futures
  // mapping trapped with "wasm trap: uninitialized element" on the first
  // OrderCreated after the backstop redeploy.
  const params = event.parameters;
  const lines = new Array<string>(params.length);
  for (let i = 0; i < params.length; i++) {
    const param = params[i];
    lines[i] = param.name + ": " + valueToString(param.value);
  }
  return "\n" + lines.join("\n");
}
