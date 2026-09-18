# Fleet Rental OS

Gig-worker vehicle rental business + SaaS operating system. Greater Nashville.

## Structure

```
/app, /lib, proxy.ts, package.json, etc.   Next.js 16 app (App Router)
                                            - Staff portal (moving to /staff)
                                            - Public homepage + lead capture (in progress)
                                            - Application Workspace (planned)
                                            - Customer Portal (planned)

/supabase/migrations/*.sql                 All 24 database migrations, in order.
                                            Apply sequentially to a fresh Supabase
                                            project. Each file's header comment
                                            explains what it does and why.

/supabase/tests/*.sql                      Real, executable CI tests (not stubs).
                                            Each wraps itself in a transaction that
                                            rolls back -- safe to run repeatedly
                                            against a live project.
                                            - domain_integrity_test.sql: 7 cases
                                              (overlap prevention, append-only
                                              ledger, immutable policy versions,
                                              webhook idempotency, recovery
                                              approval gating, state transitions)
                                            - rls_tenant_isolation_test.sql: 5
                                              SQL-testable RLS cases + 1
                                              static-analysis note (service role
                                              never in frontend code)
```

## Getting started

```
npm install
cp .env.local.example .env.local   # fill in your Supabase URL + anon key
npm run dev
```

## Database

Live project: `fleet-rental-os` on Supabase (project ref `rfrqvurreiuavuvoofiy`).
Migrations in `/supabase/migrations` are already applied there, in order,
0001 through 0024. When adding a new migration, follow the existing numbering
and header-comment convention -- explain what locked business rule or spec
section it's closing, not just what the SQL does.

## Source-of-truth documents

This build follows (in priority order):
1. Current explicit business decisions
2. Fleet Rental SaaS V2.1 Implementation Change & Synchronization Specification
3. BUILD_MASTER_SPECIFICATION_v2.0 and related v2.0 specs
4. Existing code/schema, where it doesn't conflict with the above

Design system: Fleet_Rental_SaaS_Portal_Design_System_Spec_v1_0
Customer journey: Recommended_Customer_Journey_UX_v1_0
Marketing copy: Greater_Nashville_Vehicle_Rental_Complete_Copy_v2_1
