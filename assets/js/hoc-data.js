/* ==========================================================================
   HOC TEA — hoc-data.js

   The blend catalogue, the ingredient atlas and the mood map.

   In the Shopify build this file does not ship: every field here maps to a
   product metafield or an `ingredient` metaobject (§27, §28) and is rendered
   into the markup by Liquid. It exists so the static prototype has the same
   shape of data the theme will receive, and so the metafield contract is
   written down somewhere runnable.

   CONTENT GUARDRAIL §58 — copy here describes taste, aroma, ingredient,
   colour, ritual and preparation ONLY. The source brand document contains
   health claims (immunity, blood pressure, metabolism, sleep, stress). None
   of them are carried over. They stay out until brand/legal sign-off.
   ========================================================================== */

(function (root) {
  "use strict";

  /* ------------------------------------------------------------------
     Accent hues are shared with tools/build-assets.py, which rotates the
     pack render to the same hue. Pack and UI therefore always agree.
     ------------------------------------------------------------------ */

  var BLENDS = [
    {
      slug: "gift-of-nature",
      index: "01",
      name: "Gift of Nature",
      descriptor: "Bright · Fresh · Botanical",
      notes: ["Tart", "Cooling", "Citrus"],
      ingredients: ["Hibiscus", "Mint Leaf", "Lemongrass"],
      moods: ["refresh", "brighten"],
      accent: "#47857D",
      accent2: "#7FB3AD",
      wash: "#E0EBEA",
      accentInk: "#2D4E4A",
      liquid: "#B4324B",
      price: 1400,
      story:
        "Hibiscus carries the tartness, mint leaf the cool edge, lemongrass the thin line of citrus that holds the two apart. Steeped hot it turns deep crimson; over ice it stays sharp and clean.",
      hot: { g: 3, ml: 330, c: 90, min: 5 },
      cold: { g: 4, ml: 330, hours: 8 },
      featured: true
    },
    {
      slug: "mystic-butterfly",
      index: "02",
      name: "Mystic Butterfly",
      descriptor: "Floral · Tart · Transforming",
      notes: ["Floral", "Tart", "Warm spice"],
      ingredients: ["Butterfly Pea Flower", "Hibiscus", "Cinnamon Stick"],
      moods: ["discover", "slow-down"],
      accent: "#553B91",
      accent2: "#8A75BD",
      wash: "#E2DEED",
      accentInk: "#342654",
      liquid: "#2B3A8F",
      price: 1600,
      story:
        "Butterfly pea steeps a deep, saturated blue. Add hibiscus — an acid — and the blue turns. Violet first, then magenta, spreading unevenly through the glass. Cinnamon sits underneath the whole thing.",
      hot: { g: 3, ml: 330, c: 90, min: 4 },
      cold: { g: 4, ml: 330, hours: 6 },
      featured: true,
      alchemy: true
    },
    {
      slug: "mesmerize",
      index: "03",
      name: "Mesmerize",
      descriptor: "Tropical · Sweet · Vivid",
      notes: ["Mango", "Sharp", "Grassy"],
      ingredients: [
        "Mango",
        "Pineapple",
        "Lemongrass",
        "Butterfly Pea Flower"
      ],
      moods: ["escape", "refresh"],
      accent: "#376395",
      accent2: "#7196C1",
      wash: "#DDE5EE",
      accentInk: "#243C57",
      liquid: "#2F62A8",
      price: 1600,
      story:
        "Mango and pineapple do the sweetness, lemongrass keeps it from turning syrupy, and butterfly pea pulls the whole glass toward deep blue. Best over a lot of ice.",
      hot: { g: 3, ml: 330, c: 90, min: 5 },
      cold: { g: 5, ml: 330, hours: 6 },
      featured: true
    },
    {
      slug: "sunset-valley",
      index: "04",
      name: "Sunset Valley",
      descriptor: "Soft · Sweet · Rounded",
      notes: ["Vanilla", "Berry", "Woody"],
      ingredients: ["Rooibos", "Strawberry", "Apple", "Bourbon Vanilla"],
      moods: ["slow-down", "warm-up"],
      accent: "#913B41",
      accent2: "#BD7579",
      wash: "#EDDEDF",
      accentInk: "#542629",
      liquid: "#A8462F",
      price: 1400,
      story:
        "Rooibos gives it body and a natural sweetness. Dried strawberry and apple sharpen the edges; a split vanilla pod rounds them off again. Caffeine-free, and it takes ice well.",
      hot: { g: 3, ml: 330, c: 95, min: 6 },
      cold: { g: 4, ml: 330, hours: 8 }
    },
    {
      slug: "asian-breeze",
      index: "05",
      name: "Asian Breeze",
      descriptor: "Tropical · Spiced · Warm",
      notes: ["Ginger", "Mango", "Cinnamon"],
      ingredients: [
        "Rooibos",
        "Mango",
        "Pineapple",
        "Dried Ginger",
        "Cinnamon Stick",
        "Lemon Peel"
      ],
      moods: ["warm-up", "escape"],
      accent: "#9B6231",
      accent2: "#C6966C",
      wash: "#EFE5DC",
      accentInk: "#5A3B21",
      liquid: "#B4682A",
      price: 1500,
      story:
        "Tropical fruit against dried ginger and a whole cinnamon stick. The lemon peel cuts across the top. Warm at the finish rather than hot.",
      hot: { g: 3, ml: 330, c: 95, min: 6 },
      cold: { g: 4, ml: 330, hours: 8 }
    },
    {
      slug: "souls-rest",
      index: "06",
      name: "Soul's Rest",
      descriptor: "Floral · Delicate · Still",
      notes: ["Rose", "Tart", "Honeyed"],
      ingredients: ["Oolong", "Dried Rose", "Hibiscus", "Chamomile"],
      moods: ["slow-down"],
      accent: "#85475E",
      accent2: "#B37F92",
      wash: "#EBE0E4",
      accentInk: "#4E2D39",
      liquid: "#9E4A5E",
      price: 1700,
      story:
        "Oolong underneath, rose petal and chamomile over the top, hibiscus for a thread of acidity. Quiet, and it wants a lower water temperature than the fruit blends.",
      hot: { g: 3, ml: 330, c: 85, min: 4 },
      cold: { g: 4, ml: 330, hours: 6 }
    },
    {
      slug: "gold-skies",
      index: "07",
      name: "Gold Skies",
      descriptor: "Berry · Grassy · Light",
      notes: ["Berry", "Green", "Citrus"],
      ingredients: [
        "Green Tea",
        "Lemongrass",
        "Strawberry",
        "Blackberry",
        "Butterfly Pea Flower"
      ],
      moods: ["brighten", "refresh"],
      accent: "#6B8B41",
      accent2: "#9DB87A",
      wash: "#E6ECDF",
      accentInk: "#405129",
      liquid: "#6E8A3F",
      price: 1600,
      story:
        "Green tea and lemongrass keep it thin and bright; strawberry and blackberry thicken the middle. Butterfly pea shifts the colour without adding much taste.",
      hot: { g: 3, ml: 330, c: 80, min: 3 },
      cold: { g: 4, ml: 330, hours: 6 }
    },
    {
      slug: "pink-moon",
      index: "08",
      name: "Pink Moon",
      descriptor: "Floral · Tropical · Fine",
      notes: ["Jasmine", "Pineapple", "Cinnamon"],
      ingredients: [
        "Jasmine",
        "Pineapple",
        "Hibiscus",
        "White Tea",
        "Cinnamon Stick"
      ],
      moods: ["discover", "brighten"],
      accent: "#89436B",
      accent2: "#B67C9D",
      wash: "#ECDFE6",
      accentInk: "#502A40",
      liquid: "#B04E77",
      price: 1800,
      story:
        "White tea is the lightest base in the range, so everything sits on top of it: jasmine first, then pineapple, then a long cinnamon finish.",
      hot: { g: 3, ml: 330, c: 80, min: 3 },
      cold: { g: 4, ml: 330, hours: 6 }
    },
    {
      slug: "innerbloom",
      index: "09",
      name: "Innerbloom",
      descriptor: "Floral · Soft · Calm",
      notes: ["Lavender", "Chamomile", "Herbal"],
      ingredients: ["Jasmine", "Chamomile", "Lavender", "Lemon Balm"],
      moods: ["slow-down"],
      accent: "#6C4983",
      accent2: "#9E81B1",
      wash: "#E7E0EB",
      accentInk: "#402E4D",
      liquid: "#B9A44C",
      price: 1500,
      story:
        "Four flowers and a leaf. Lavender is the loudest, so the blend is built around keeping it in proportion — chamomile softens it, lemon balm lifts the finish.",
      hot: { g: 3, ml: 330, c: 90, min: 5 },
      cold: { g: 4, ml: 330, hours: 8 }
    },
    {
      slug: "white-tea-melody",
      index: "10",
      name: "White Tea Melody",
      descriptor: "Fruity · Light · Warm",
      notes: ["Strawberry", "Mango", "Peel"],
      ingredients: [
        "Strawberry",
        "White Tea",
        "Lemon Peel",
        "Apple",
        "Mango",
        "Cinnamon Stick"
      ],
      moods: ["brighten", "escape"],
      accent: "#8B5241",
      accent2: "#B8887A",
      wash: "#ECE2DF",
      accentInk: "#513329",
      liquid: "#C06A4A",
      price: 1700,
      story:
        "Strawberry and mango on a white tea base, apple for weight, lemon peel and cinnamon at either end of the finish.",
      hot: { g: 3, ml: 330, c: 80, min: 4 },
      cold: { g: 4, ml: 330, hours: 6 }
    },
    {
      slug: "reflection",
      index: "11",
      name: "Reflection",
      descriptor: "Fruity · Tart · Grounded",
      notes: ["Blackberry", "Tart", "Citrus"],
      ingredients: [
        "Passionflower",
        "Apple",
        "Lemongrass",
        "Hibiscus",
        "Blackberry"
      ],
      moods: ["slow-down", "discover"],
      accent: "#854785",
      accent2: "#B37FB3",
      wash: "#EBE0EB",
      accentInk: "#4E2D4E",
      liquid: "#8A3B63",
      price: 1500,
      story:
        "Passionflower and apple make the base broad and low; hibiscus and blackberry put the colour and the acidity back in. Lemongrass runs through the middle.",
      hot: { g: 3, ml: 330, c: 90, min: 5 },
      cold: { g: 4, ml: 330, hours: 8 }
    },
    {
      slug: "winter-tale",
      index: "12",
      name: "Winter Tale",
      descriptor: "Spiced · Citrus · Warming",
      notes: ["Ginger", "Orange", "Malty"],
      ingredients: [
        "Rooibos",
        "Mate",
        "Fresh Ginger",
        "Strawberry",
        "Orange Peel"
      ],
      moods: ["warm-up"],
      accent: "#975235",
      accent2: "#C3886F",
      wash: "#EEE2DD",
      accentInk: "#583323",
      liquid: "#A85426",
      price: 1600,
      story:
        "Mate over rooibos, so it has a pull the other winter blends don't. Ginger heats the finish and orange peel keeps it from going flat.",
      hot: { g: 3, ml: 330, c: 95, min: 6 },
      cold: { g: 4, ml: 330, hours: 8 }
    },
    {
      slug: "wintertide",
      index: "13",
      name: "Wintertide",
      descriptor: "Sweet · Aniseed · Tart",
      notes: ["Rosehip", "Fennel", "Apple"],
      ingredients: ["Apple", "Mango", "Rosehip", "Fennel", "Passionflower"],
      moods: ["warm-up", "slow-down"],
      accent: "#997A33",
      accent2: "#C4AA6E",
      wash: "#EFE9DC",
      accentInk: "#594822",
      liquid: "#C0752F",
      price: 1500,
      story:
        "Rosehip brings the tartness, fennel the aniseed note underneath it. Apple and mango round the front of the sip; passionflower sits at the back.",
      hot: { g: 3, ml: 330, c: 95, min: 6 },
      cold: { g: 4, ml: 330, hours: 8 }
    },
    {
      slug: "bloomera",
      index: "14",
      name: "Bloomera",
      descriptor: "Spiced · Fruity · Tart",
      notes: ["Cinnamon", "Apple", "Peel"],
      ingredients: ["Apple", "Cinnamon Stick", "Hibiscus", "Orange Peel"],
      moods: ["warm-up", "brighten"],
      accent: "#954437",
      accent2: "#C17C71",
      wash: "#EEDFDD",
      accentInk: "#572B24",
      liquid: "#B03C33",
      price: 1400,
      story:
        "Four ingredients, no filler. Apple and cinnamon carry it, hibiscus supplies the acidity and the colour, orange peel finishes it dry.",
      hot: { g: 3, ml: 330, c: 95, min: 6 },
      cold: { g: 4, ml: 330, hours: 8 }
    }
  ];

  /* ------------------------------------------------------------------
     Packaging §11 — TIN / DOYPACK selector on the featured stage.
     ------------------------------------------------------------------ */
  var PACKAGING = [
    { id: "tin", label: "Tin", weight: "80 g", delta: 400 },
    { id: "doypack", label: "Doypack", weight: "100 g", delta: 0 }
  ];

  /* ------------------------------------------------------------------
     Ingredient atlas §16 / metaobject §28.
     Taste, aroma, colour, origin. No health claims.
     ------------------------------------------------------------------ */
  var INGREDIENTS = [
    {
      slug: "hibiscus",
      name: "Hibiscus",
      botanical: "Hibiscus sabdariffa",
      profile: "Tart",
      aroma: "Red fruit, cranberry",
      color: "Crimson",
      accent: "#B4324B",
      note: "The acid in the range. It is what turns butterfly pea from blue to magenta."
    },
    {
      slug: "mint",
      name: "Mint Leaf",
      botanical: "Mentha spicata",
      profile: "Cooling",
      aroma: "Green, menthol",
      color: "Pale green",
      accent: "#5E9A62",
      note: "Cools the finish rather than the first sip. Holds up well over ice."
    },
    {
      slug: "lemongrass",
      name: "Lemongrass",
      botanical: "Cymbopogon citratus",
      profile: "Citrus",
      aroma: "Lemon rind, grass",
      color: "Straw",
      accent: "#A9A24B",
      note: "A thin line of citrus that keeps sweeter blends from closing up."
    },
    {
      slug: "butterfly-pea",
      name: "Butterfly Pea",
      botanical: "Clitoria ternatea",
      profile: "Neutral",
      aroma: "Faint, earthy-sweet",
      color: "Deep indigo",
      accent: "#3B3B8F",
      note: "Almost no taste, all colour. Steeps indigo, then reacts to acid."
    },
    {
      slug: "cinnamon",
      name: "Cinnamon Stick",
      botanical: "Cinnamomum verum",
      profile: "Warm",
      aroma: "Sweet wood, clove",
      color: "Amber",
      accent: "#9B5B2E",
      note: "Used whole, so it releases slowly and never dominates the front."
    },
    {
      slug: "mango",
      name: "Mango",
      botanical: "Mangifera indica",
      profile: "Sweet",
      aroma: "Ripe stone fruit",
      color: "Gold",
      accent: "#D99A32",
      note: "Dried in pieces. The sweetness that lets tart blends read as fruit."
    },
    {
      slug: "pineapple",
      name: "Pineapple",
      botanical: "Ananas comosus",
      profile: "Sharp",
      aroma: "Bright, resinous",
      color: "Pale gold",
      accent: "#C8A93F",
      note: "Acidic where mango is sweet. The two are usually paired."
    },
    {
      slug: "strawberry",
      name: "Strawberry",
      botanical: "Fragaria × ananassa",
      profile: "Sweet-tart",
      aroma: "Jam, green stem",
      color: "Rose",
      accent: "#C0485C",
      note: "Dried, so the flavour is denser and less watery than fresh."
    },
    {
      slug: "apple",
      name: "Apple",
      botanical: "Malus domestica",
      profile: "Rounded",
      aroma: "Orchard, faint honey",
      color: "Pale amber",
      accent: "#B08A4A",
      note: "Bulk and body. It is what makes a blend feel full rather than thin."
    },
    {
      slug: "lavender",
      name: "Lavender",
      botanical: "Lavandula angustifolia",
      profile: "Floral",
      aroma: "Camphor, honey",
      color: "Pale violet",
      accent: "#8A7FB5",
      note: "Measured carefully. A little reads as floral, more reads as soap."
    },
    {
      slug: "chamomile",
      name: "Chamomile",
      botanical: "Matricaria chamomilla",
      profile: "Soft",
      aroma: "Hay, apple",
      color: "Pale gold",
      accent: "#C9AE55",
      note: "Rounds off sharper flowers. Steeps a clean, light yellow."
    },
    {
      slug: "ginger",
      name: "Ginger",
      botanical: "Zingiber officinale",
      profile: "Hot",
      aroma: "Peppery, bright",
      color: "Straw",
      accent: "#C08A3A",
      note: "Builds through the cup. The heat arrives after the swallow."
    },
    {
      slug: "orange-peel",
      name: "Orange Peel",
      botanical: "Citrus sinensis",
      profile: "Bittersweet",
      aroma: "Oil, zest",
      color: "Orange",
      accent: "#CE7B33",
      note: "Dries the finish. Keeps fruit blends from tasting like squash."
    },
    {
      slug: "rooibos",
      name: "Rooibos",
      botanical: "Aspalathus linearis",
      profile: "Woody",
      aroma: "Vanilla, tobacco leaf",
      color: "Russet",
      accent: "#9C4B2A",
      note: "Naturally caffeine-free and naturally sweet. The winter base."
    },
    {
      slug: "rose",
      name: "Dried Rose",
      botanical: "Rosa damascena",
      profile: "Floral",
      aroma: "Rose oil, honey",
      color: "Dusty pink",
      accent: "#B0697E",
      note: "Petals only. Aroma leads; the taste behind it is very light."
    },
    {
      slug: "blackberry",
      name: "Blackberry",
      botanical: "Rubus fruticosus",
      profile: "Deep",
      aroma: "Dark berry, wine",
      color: "Purple-black",
      accent: "#5E3350",
      note: "Adds weight and a purple cast to green-tea blends."
    }
  ];

  /* ------------------------------------------------------------------
     Mood map §15 — discovery by feeling, before category.
     ------------------------------------------------------------------ */
  var MOODS = [
    {
      id: "refresh",
      label: "Refresh",
      meta: "FRESH / CITRUS / COOLING",
      blend: "gift-of-nature",
      ingredients: ["mint", "hibiscus", "lemongrass"]
    },
    {
      id: "escape",
      label: "Escape",
      meta: "TROPICAL / SWEET / VIVID",
      blend: "mesmerize",
      ingredients: ["mango", "pineapple", "butterfly-pea"]
    },
    {
      id: "slow-down",
      label: "Slow Down",
      meta: "FLORAL / SOFT / HERBAL",
      blend: "innerbloom",
      ingredients: ["lavender", "chamomile", "rose"]
    },
    {
      id: "brighten",
      label: "Brighten",
      meta: "BERRY / GREEN / LIGHT",
      blend: "gold-skies",
      ingredients: ["strawberry", "blackberry", "lemongrass"]
    },
    {
      id: "warm-up",
      label: "Warm Up",
      meta: "SPICED / CITRUS / DEEP",
      blend: "winter-tale",
      ingredients: ["ginger", "orange-peel", "cinnamon"]
    },
    {
      id: "discover",
      label: "Discover",
      meta: "FLORAL / TART / CHANGING",
      blend: "mystic-butterfly",
      ingredients: ["butterfly-pea", "hibiscus", "cinnamon"]
    }
  ];

  /* ------------------------------------------------------------------
     Helpers
     ------------------------------------------------------------------ */
  var bySlug = {};
  BLENDS.forEach(function (b) {
    bySlug[b.slug] = b;
  });

  var ingBySlug = {};
  INGREDIENTS.forEach(function (i) {
    ingBySlug[i.slug] = i;
  });

  function money(cents, currency) {
    return (
      (currency || "€") +
      (cents / 100).toFixed(2).replace(/\.00$/, "")
    );
  }

  root.HOC = root.HOC || {};
  root.HOC.data = {
    blends: BLENDS,
    packaging: PACKAGING,
    ingredients: INGREDIENTS,
    moods: MOODS,
    blend: function (slug) {
      return bySlug[slug];
    },
    ingredient: function (slug) {
      return ingBySlug[slug];
    },
    featured: BLENDS.filter(function (b) {
      return b.featured;
    }),
    money: money
  };
})(window);
