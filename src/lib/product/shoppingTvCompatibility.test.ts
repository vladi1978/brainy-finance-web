import assert from "node:assert/strict";
import test from "node:test";
import {
  extractShoppingTvInches,
  isTelevisionProductTitle,
  isTvShoppingAccessory,
  listingScreenInches,
  shoppingTvListingAllowed,
  tvScreenSizeCompatibility,
} from "./shoppingTvCompatibility";

test("TV wall mounts and stands are shopping accessories", () => {
  assert.equal(
    isTvShoppingAccessory("SANUS Advanced Tilt 65 Inch TV Wall Mount"),
    true
  );
  assert.equal(
    isTvShoppingAccessory("Walker Edison 65 Inch TV Stand with Storage"),
    true
  );
  assert.equal(
    isTelevisionProductTitle("Samsung 65 Inch Class 4K Smart TV"),
    true
  );
  assert.equal(
    shoppingTvListingAllowed("SANUS Advanced Tilt 65 Inch TV Wall Mount"),
    false
  );
});

test("65 vs 55 inch compatibility", () => {
  assert.equal(listingScreenInches("Samsung 65 Inch Class 4K Smart TV"), 65);
  assert.equal(listingScreenInches("Hisense 55 Inch Class 4K Smart TV"), 55);
  assert.equal(tvScreenSizeCompatibility(65, 65), "match");
  assert.equal(tvScreenSizeCompatibility(65, 55), "mismatch");
  assert.equal(tvScreenSizeCompatibility(65, null), "unknown");
});

test("shopping TV size parser reads common title phrases without SKU inference", () => {
  assert.equal(extractShoppingTvInches('Samsung 65" Crystal UHD'), 65);
  assert.equal(extractShoppingTvInches("TCL 65-inch 4K TV"), 65);
  assert.equal(extractShoppingTvInches("LG 65in OLED"), 65);
  assert.equal(extractShoppingTvInches("Sony 65 in. Bravia"), 65);
  assert.equal(extractShoppingTvInches("Class 65 4K UHD Smart TV"), 65);
  assert.equal(extractShoppingTvInches("Westinghouse 58-In. 4K Roku TV"), 58);
  assert.equal(extractShoppingTvInches("LG C6 OLED evo AI Smart 4K TV"), null);
});
