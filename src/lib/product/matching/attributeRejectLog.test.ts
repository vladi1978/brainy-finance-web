import assert from "node:assert/strict";
import test from "node:test";
import { classifyAttributeRejectReason } from "./attributeRejectLog";

test("classifyAttributeRejectReason maps brand gates", () => {
  assert.equal(
    classifyAttributeRejectReason("screen_brand_incomplete(source=samsung,candidate=)"),
    "brand_mismatch"
  );
});

test("classifyAttributeRejectReason maps model gates", () => {
  assert.equal(
    classifyAttributeRejectReason(
      "tv_full_model_mismatch(source_full=UN65DU7200,candidate_full=UN55DU7200)"
    ),
    "model_mismatch"
  );
  assert.equal(
    classifyAttributeRejectReason("department_tools_model_mismatch"),
    "model_mismatch"
  );
});

test("classifyAttributeRejectReason maps size gates", () => {
  assert.equal(
    classifyAttributeRejectReason(
      "screen_size_mismatch(source=65,candidate=50,delta=15)"
    ),
    "size_mismatch"
  );
  assert.equal(
    classifyAttributeRejectReason("wrong screen size"),
    "size_mismatch"
  );
});

test("classifyAttributeRejectReason maps family gates", () => {
  assert.equal(
    classifyAttributeRejectReason(
      "tv_model_family_mismatch(source=DU7200,candidate=CU7000)"
    ),
    "family_mismatch"
  );
  assert.equal(
    classifyAttributeRejectReason(
      "incompatible_product_family(source=tv,candidate=footwear)"
    ),
    "family_mismatch"
  );
});

test("classifyAttributeRejectReason maps category gates", () => {
  assert.equal(
    classifyAttributeRejectReason("comparison_category_mismatch(tv vs apparel)"),
    "category_mismatch"
  );
  assert.equal(classifyAttributeRejectReason("accessory only"), "category_mismatch");
});

test("classifyAttributeRejectReason maps bundle gates", () => {
  assert.equal(
    classifyAttributeRejectReason("pack_count_mismatch(1 vs 6)"),
    "bundle_mismatch"
  );
  assert.equal(
    classifyAttributeRejectReason("bare tool when kit expected"),
    "bundle_mismatch"
  );
});

test("classifyAttributeRejectReason maps storage gates", () => {
  assert.equal(
    classifyAttributeRejectReason("capacity_mismatch(256gb vs 128gb)"),
    "storage_mismatch"
  );
});
