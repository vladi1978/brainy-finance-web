import { createBasicRetailProvider } from "./retailProviderFactory";

export const wayfairProvider = createBasicRetailProvider({
  id: "wayfair",
  hostPattern: /wayfair\.com/i,
});
