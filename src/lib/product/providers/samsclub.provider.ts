import { createBasicRetailProvider } from "./retailProviderFactory";

export const samsclubProvider = createBasicRetailProvider({
  id: "samsclub",
  hostPattern: /samsclub\.com/i,
});
