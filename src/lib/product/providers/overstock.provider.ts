import { createBasicRetailProvider } from "./retailProviderFactory";

export const overstockProvider = createBasicRetailProvider({
  id: "overstock",
  hostPattern: /overstock\.com/i,
});
