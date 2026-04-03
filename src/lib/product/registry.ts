import { ProductProvider } from "./providers/base";
import { amazonProvider } from "./providers/amazon.provider";
import { walmartProvider } from "./providers/walmart.provider";

export const providerRegistry: ProductProvider[] = [
  amazonProvider,
  walmartProvider,
];