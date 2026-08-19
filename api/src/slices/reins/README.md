# reins (knowledge / RAG)

Ranch stores sources, hands them to LightRAG, and reads the graph back. Two
things about that boundary are not obvious from the code and have each cost a
day of debugging, so they are written down here.

## LightRAG has no per-knowledge isolation

`workspaceOf(knowledgeId)` builds a name and every ingest call carries it, but
**LightRAG ignores it**. A workspace there belongs to the instance, set by the
`WORKSPACE` env var or `--workspace` at startup; the document and query
endpoints have no per-request equivalent. For the PostgreSQL storages every row
lands in the workspace the container was started with, which is `default` when
nothing is configured.

Consequences, all of them live today:

- Every knowledge base shares one pile of documents, one entity graph, one set
  of vectors.
- A query is not scoped to a base. An agent bound to base A can be answered
  from base B's documents, with no error and nothing visible in the admin.
- Deleting "all documents" deletes them for every base at once.

Real isolation means one LightRAG instance per base, each with its own
`WORKSPACE` against the shared Postgres (the upstream docs describe this
layout). That is an infrastructure change and a cost decision, not something
the API can work around. Until it is made, treat the LightRAG index as global
and keep one base per environment if answers must not mix.

## Changing the extraction model requires clearing the LLM cache

LightRAG caches every extraction and summary response in `lightrag_llm_cache`,
keyed by the content of the chunk and the prompt. **The model is not part of
that key.** Swap `LLM_MODEL`, re-index the same documents, and LightRAG serves
the previous model's answers straight from cache: the run takes hours, costs
money on the handful of uncached chunks, and rebuilds a graph identical to the
one you were trying to replace. Nothing in the logs says "cache hit", and the
`LLM output format error` warnings reappear because malformed cached output is
re-parsed on every rebuild.

The `DELETE /documents` endpoint does not clear this table. When changing the
extraction model, in order:

```sql
TRUNCATE lightrag_llm_cache;
```

then clear the documents, then re-index. Verify the run is real before waiting
on it - fresh rows should appear for the current hour:

```sql
SELECT date_trunc('hour', create_time) AS hour, count(*)
FROM lightrag_llm_cache WHERE cache_type = 'extract' GROUP BY 1 ORDER BY 1;
```

The same applies to the embedding model, with a bigger blast radius: embedding
dimension is fixed when the vector tables are created, so changing it needs the
vector storage recreated, not just the cache emptied.

## Picking an extraction model

Entity and relation extraction asks the model for records in a fixed field
layout. Models that do not hold that layout produce records that fail to parse,
which is logged as `LLM output format error` and drops the record silently -
relations suffer worst, because a relation needs all five fields while an
entity survives on four.

Measured on the same 1181-chunk corpus:

| model | relations per chunk | format errors |
|---|---|---|
| `amazon.nova-lite-v1:0` | 12.6 | ~1 per 3 chunks |
| `amazon.nova-pro-v1:0` | 7.6 | ~1 per 3 chunks |
| `us.anthropic.claude-haiku-4-5-...` | 23.0 | 0 in ~2000 calls |

Neither Nova model is usable for this. If a model has to be evaluated, index
one document dense with short capitalised terms and punctuation inside names -
tables of UI gestures and part names are what broke the Nova models - and count
the warnings:

```bash
kubectl -n <ns> logs deploy/lightrag --since=10m | grep -c "LLM output format error"
```

Note that this counter reads the *parse* step, so it also fires when cached
output from an older model is re-parsed. Clear the cache first or the number
describes the previous model.
