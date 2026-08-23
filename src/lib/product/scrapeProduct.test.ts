import assert from "node:assert/strict";
import test from "node:test";
import { buildNormalizedProduct, extractSizeInches } from "./normalize";
import {
  selectPdpTitleFromHtml,
  selectPdpTitleFromPageSignals,
} from "./scrapeProduct";

const JSON_LD_65 =
  '<script type="application/ld+json">{"@type":"Product","name":"Roku 65 Inch Class Select Series 4K QLED Smart TV"}</script>';

test("selectPdpTitleFromHtml prefers visible 50 inch over JSON-LD 65 inch", () => {
  const html = `<html><head>${JSON_LD_65}</head><body>
    <span id="productTitle">Roku 50 Inch Class Select Series 4K QLED Smart TV Quantum Dot HDR</span>
  </body></html>`;

  const sel = selectPdpTitleFromHtml(html, "www.amazon.com", {
    name: "Roku 65 Inch Class Select Series 4K QLED Smart TV",
  });

  assert.equal(sel.reason, "visible_pdp_title");
  assert.match(sel.selectedTitle ?? "", /50\s*Inch/i);
  assert.match(sel.visibleTitle ?? "", /50\s*Inch/i);
  assert.match(sel.jsonLdName ?? "", /65\s*Inch/i);
  assert.equal(sel.conflictDetected, true);
  assert.equal(extractSizeInches(sel.selectedTitle ?? ""), 50);
});

test("selectPdpTitleFromHtml prefers visible model over JSON-LD model", () => {
  const html = `<html><head>
    <script type="application/ld+json">{"@type":"Product","name":"Samsung 65 Inch QN90C Neo QLED Smart TV"}</script>
  </head><body>
    <h1 data-testid="product-title-heading">Samsung 50 Inch DU7200 Crystal UHD Smart TV</h1>
  </body></html>`;

  const sel = selectPdpTitleFromHtml(html, "www.bestbuy.com", {
    name: "Samsung 65 Inch QN90C Neo QLED Smart TV",
  });

  assert.equal(sel.reason, "visible_pdp_title");
  assert.match(sel.selectedTitle ?? "", /DU7200/i);
  assert.doesNotMatch(sel.selectedTitle ?? "", /QN90C/i);
  assert.equal(sel.conflictDetected, true);

  const norm = buildNormalizedProduct(sel.selectedTitle ?? "");
  assert.match(norm.structured.fullModel ?? norm.titleNorm, /du7200/i);
});

test("selectPdpTitleFromHtml uses same visible-first priority on Walmart", () => {
  const html = `<html><head>${JSON_LD_65.replace("Roku", "Onn")}</head><body>
    <h1 data-automation-id="product-title">Onn 50 Inch Class 4K Roku Smart TV</h1>
  </body></html>`;

  const sel = selectPdpTitleFromHtml(html, "www.walmart.com", {
    name: "Onn 65 Inch Class 4K Roku Smart TV",
  });

  assert.equal(sel.reason, "visible_pdp_title");
  assert.match(sel.selectedTitle ?? "", /50\s*Inch/i);
  assert.equal(sel.conflictDetected, true);
});

test("selectPdpTitleFromHtml falls back to JSON-LD when visible title is missing", () => {
  const html = `<html><head>
    ${JSON_LD_65}
    <meta property="og:title" content="Roku 50 Inch Class TV" />
    <title>Roku Store</title>
  </head><body></body></html>`;

  const sel = selectPdpTitleFromHtml(html, "www.amazon.com", {
    name: "Roku 65 Inch Class Select Series 4K QLED Smart TV",
  });

  assert.equal(sel.reason, "json_ld_name");
  assert.match(sel.selectedTitle ?? "", /65\s*Inch/i);
  assert.equal(sel.visibleTitle, null);
  assert.equal(sel.conflictDetected, false);
});

test("selectPdpTitleFromHtml falls back to og:title when visible and JSON-LD are missing", () => {
  const html = `<html><head>
    <meta property="og:title" content="Hisense 55 Inch U6 Series 4K ULED Smart TV" />
    <title>Electronics</title>
  </head><body></body></html>`;

  const sel = selectPdpTitleFromHtml(html, "www.target.com", {});

  assert.equal(sel.reason, "og_title");
  assert.match(sel.selectedTitle ?? "", /Hisense 55 Inch/i);
});

test("selectPdpTitleFromPageSignals prefers JSON-LD over og:title", () => {
  const sel = selectPdpTitleFromPageSignals({
    documentTitle: "Storefront",
    ogTitle: "Wrong OG Title for Product",
    twitterTitle: null,
    jsonLdProductName: "Sony WH-1000XM5 Wireless Headphones Black",
    ogDescription: null,
    metaDescription: null,
  });

  assert.equal(sel.reason, "json_ld_name");
  assert.match(sel.selectedTitle ?? "", /WH-1000XM5/i);
});
