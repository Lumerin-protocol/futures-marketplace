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
  return (
    "\n" +
    event.parameters
      .map<string>((param) => param.name + ": " + valueToString(param.value))
      .join("\n")
  );
}
