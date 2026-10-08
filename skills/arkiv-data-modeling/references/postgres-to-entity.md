# Map PostgreSQL to Arkiv entities

Use schema-only DDL and the actual query workload. Do not request database credentials to produce a model. This mapping preserves field meaning; it does not import rows or reproduce PostgreSQL constraint enforcement.

## Choose field destinations

| PostgreSQL concept | Entity mapping | Decision to retain |
| --- | --- | --- |
| Table | One entity type, scoped by `project` and `entity_type` | Owner, trusted creator and Entity Expiration policy |
| Primary key / UUID | Stable source ID in payload; `str` attribute when queried | Composite key encoding and application uniqueness |
| Boolean | `bool` attribute if filtered; otherwise payload | Keep false distinct from null |
| Small signed integer | `i32` when its range fits | Reject overflow before writing |
| Signed `BIGINT` | Exact payload string; `dec(sourceIntegerString)` for a signed queryable integer | `u64`/`u256` cannot store negative values; full signed 64-bit range does not fit `i32`. Never parse through an unsafe JavaScript number. |
| Nonnegative large integer | `u64` or `u256` according to declared range | Do not parse through an unsafe JavaScript number |
| Exact decimal / money | `dec` string up to 18 fractional places, or minor units with a declared scale | Reject unsupported precision/range; define rounding and currency |
| Timestamp | Original timezone meaning in payload; `u64` epoch milliseconds if projected | Pre-epoch signed times and timezone conversion need an explicit encoding |
| Text / varchar | Payload unless queried; bounded `str` for equality/prefix | Explicit encoded UTF-8 byte limit of at most 128, not a sampled length |
| JSON / arrays | Payload with original nulls, order and duplicates | An array membership projection is a separate relationship model |
| Foreign key | Source ID join or resolved `key` reference | Missing targets, remapping and expiration; no automatic foreign-key check |
| SQL UNIQUE / CHECK / NOT NULL | Application validation plus write coordination | No implicit node constraint or automatic SQL transaction semantics |
| SQL JOIN / ORDER BY / aggregate | Bounded traversal, projection, or deliberate client calculation | Cardinality, all-page reads, consistency and write amplification |

Nullable projected fields are absent attributes. Only a complete attribute projection can distinguish absent from unselected. An update to null must explicitly unset the old attribute. Preserve zero, false and empty strings. Keep a source-to-destination map so a row can be reconstructed from payload and attributes without contradictory copies.

Do not mark a model complete after dropping a requested filter. For unsupported source ranges, query operators or field counts, return the unresolved decision and a concrete alternative. Check the 30-user-attribute create budget after adding namespaces, source IDs and schema/version fields.

## Example: listings and tags

A listings table can project listing ID, seller, price, currency, active flag and application timestamp as typed attributes. Store a long title, description and the original ordered tag array in payload. A listing-tag relation projects the listing ID, resolved listing key and one tag; put an ordinal in its payload if order or duplicates matter.

Create the listing first and tag entities second, or use an exclusive creator queue with predicted keys for one atomic batch. Both forms require an application uniqueness and repair policy. A relation is not a native SQL JOIN, foreign-key constraint or indexed array.

## Optional deterministic converter

The reviewed `postgres-to-entity` 0.3.1 archive is a model-only PostgreSQL DDL converter. Read the installed package's README and request example before using it. Its public input is `sql`, not a canonical `schema` object. It accepts a subset of `CREATE TABLE`; unsupported statements block conversion instead of silently producing a complete model.

The converter uses `ds`/`kind` namespace fields, while this skill's worked model uses `project`/`entity_type`. Choose one convention per application and update every writer, reader and relationship projection together.

Supply the requested filters and privacy/owner/expiration choices. `filters: []` explicitly chooses entity-key/owner access; omitting filters leaves a decision open. An intended array `contains` projection produces relationship entities, not a native `contains` query operator. Text projections require an explicit UTF-8 byte bound.

`modelled` means the supplied structure and decisions mapped; it is not proof of optimal queries or SQL constraints. `needs-input` retains open decisions. `blocked` must remain blocked until its cause is resolved. The tool does not read database rows, import data or create a wallet.

The archive README was inspected; package installation and CLI execution are not required for this skill. Follow the installed version's current CLI contract rather than copying commands from an earlier package name. Source: [versioned archive](https://github.com/SantiagoDevRel/postgres-to-entity/releases/download/v0.3.1/postgres-to-entity-0.3.1.tgz), [repository](https://github.com/SantiagoDevRel/postgres-to-entity).

SDK basis, 0.8.1: [attribute types](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/attr/types.ts), [value validation](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/attr/values.ts), [querying documentation](https://docs.arkiv.network/typescript-sdk/querying-data/). Checked 2026-10-05.
