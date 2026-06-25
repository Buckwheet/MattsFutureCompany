# Automated Daily Health Report System

This plan outlines how we will add an automated daily API and website testing feature that sends a health report to your Gmail account.

## User Review Required

> [!IMPORTANT]
> - Is `mattssmallenginerep@gmail.com` the correct Gmail address to receive the daily health reports?
> - What time of day would you like the daily report to run and send? By default, I will set it to run at 8:00 AM UTC (which is 3:00 AM / 4:00 AM Central Time, meaning it will be in your inbox when you wake up).
> - Please approve this plan so I can implement the scheduled tester.

## Proposed Changes

### Backend Worker

We will leverage Cloudflare Workers' built-in **Cron Triggers** to execute a scheduled task once every 24 hours without requiring an external server or service to keep track of time.

#### [MODIFY] [wrangler.toml](file:///C:/Users/rpgfi/Documents/Other%20Code%20Projects/MattsFutureCompany/backend/wrangler.toml)
- Add a `[triggers]` configuration block with a cron expression to schedule the worker to run once a day (e.g., `crons = ["0 8 * * *"]`).

#### [MODIFY] [index.js](file:///C:/Users/rpgfi/Documents/Other%20Code%20Projects/MattsFutureCompany/backend/index.js)
- Add an `async scheduled(controller, env, ctx)` handler alongside the existing `fetch` handler.
- The `scheduled` handler will perform the following checks:
  1. **Main Website:** Fetch `https://petersonsmallenginerepair.com` to ensure it returns a `200 OK`.
  2. **Inventory Dashboard:** Fetch `https://inventory.petersonsmallenginerepair.com` to ensure it returns a `200 OK`.
  3. **Database Health:** Run a quick `SELECT COUNT(*) FROM parts` query against the D1 SQL database to ensure it's responsive.
  4. **Integration Status:** Verify that the Stripe, Resend, and Square API keys are correctly configured in the environment.
- Format the results into a clean HTML email report with pass/fail statuses.
- Use the existing Resend integration (`env.RESEND_API_KEY`) to send the email report to your Gmail address.

## Verification Plan

### Automated Tests
- Once deployed, we can test the worker using Cloudflare's dashboard or CLI to manually trigger the `scheduled` event and verify the email arrives in your inbox with accurate data.

### Manual Verification
- Review the generated email for correct formatting and accurate system statuses.
