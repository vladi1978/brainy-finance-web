import { createBasicRetailProvider } from "./retailProviderFactory";

export const chewyProvider = createBasicRetailProvider({
  id: "chewy",
  hostPattern: /chewy\.com/i,
});
