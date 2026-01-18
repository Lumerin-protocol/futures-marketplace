import { type TStringOptions, type TUnsafe, Type } from "typebox";

export const TypeEthAddress = (opt?: TStringOptions) =>
  Type.String({ ...opt, pattern: "^0x[a-fA-F0-9]{40}$" }) as unknown as TUnsafe<`0x${string}`>;
