import { Type } from "typebox";
import { TypeEthAddress } from "../lib/type.ts";

export const PostNotificationBody = Type.Object({
  walletAddress: TypeEthAddress(),
  collateralBalance: Type.String(),
  minBalance: Type.String(),
});
