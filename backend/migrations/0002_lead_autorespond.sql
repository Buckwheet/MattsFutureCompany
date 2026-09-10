-- Required by the lead route's per-recipient daily auto-response cap.
CREATE TABLE IF NOT EXISTS lead_autorespond (
    email TEXT NOT NULL,
    day TEXT NOT NULL,
    PRIMARY KEY (email, day)
);
