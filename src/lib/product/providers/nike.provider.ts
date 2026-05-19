import { createBasicRetailProvider } from "./retailProviderFactory";

export const nikeProvider = createBasicRetailProvider({
  id: "nike",
  hostPattern: /nike\.com/i,
});
