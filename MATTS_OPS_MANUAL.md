# 🔧 Matt's Operations Manual
## Peterson Small Engine Repair

This manual covers the high-tech systems running your business.

---

### 1. The Inventory Dashboard
**URL:** [inventory.petersonsmallenginerepair.com](https://inventory.petersonsmallenginerepair.com)

**How to add a new part:**
1. Log in with your Gmail account.
2. Tap **"Scan UPC"** and point your camera at the barcode.
3. The app will automatically identify the part name and description.
4. Tap **"Take Photo"** to snap a picture of the part (this will show up on customer quotes!).
5. Enter the price and hit **Save**.
   * *The part is now instantly available in your Stripe Product Catalog.*

**Daily Stock Management:**
* Tap the **`+`** or **`-`** buttons next to any part as you use them or buy more.
* The "Value" at the top shows the total dollar amount of parts currently in your garage.

---

### 2. Handling New Leads
When a customer fills out the form on your website:
1. **The Lead Email**: You'll get an email from "Peterson Leads."
2. **One-Click Quote**: Click the big red **"+ Create Quote"** button in that email.
3. **Stripe Profile**: It will open Stripe with that customer already selected. 
4. **Billing**: Add your labor and the parts you just scanned in the garage.

---

### 3. Automated Inventory Deduction
**You don't have to manually subtract parts after a sale!**
When a customer pays an Invoice or Quote in Stripe, the system "listens" for that payment and automatically subtracts those parts from your Inventory list.

---

### 4. Security & Tech
* **Zero Trust**: Your dashboard is secured by Cloudflare. Only your specific email address can log in.
* **Database**: All data is backed up on Cloudflare's global SQL network (D1).
* **Photos**: All photos are stored in your private R2 bucket.

---
*Manual Generated on May 2, 2026*
