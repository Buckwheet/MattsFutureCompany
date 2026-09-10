-- Parts Table
CREATE TABLE IF NOT EXISTS parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sku TEXT UNIQUE,
    upc TEXT UNIQUE,
    description TEXT,
    quantity INTEGER DEFAULT 0,
    reorder_point INTEGER DEFAULT 2,
    price REAL DEFAULT 0.0,
    image_url TEXT,
    stripe_product_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Part Categories (Optional for future use)
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

-- Processed Stripe Events (Deduplication)
CREATE TABLE IF NOT EXISTS processed_stripe_events (
    id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Customer auto-response cap: at most one auto-reply per recipient per UTC day,
-- so a lead-form spam run cannot turn our domain into a backscatter source.
CREATE TABLE IF NOT EXISTS lead_autorespond (
    email TEXT NOT NULL,
    day TEXT NOT NULL,
    PRIMARY KEY (email, day)
);

