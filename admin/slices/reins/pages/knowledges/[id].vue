<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core';
import { Button } from '#theme/components/ui/button';
import type { IKnowledge } from '#reins/stores/knowledge';

const route = useRoute();
const store = useKnowledgeStore();
const confirmStore = useConfirmStore();

const knowledgeId = computed(() => route.params.id as string);
const current = ref<IKnowledge | null>(null);
const indexing = ref(false);
const indexError = ref<string | null>(null);

async function refresh() {
  current.value = await store.fetchById(knowledgeId.value);
}

await refresh();

const { pause, resume } = useIntervalFn(
  async () => {
    await refresh();
    if (current.value?.indexStatus !== 'indexing') {
      pause();
    }
  },
  3000,
  { immediate: false },
);

watch(
  () => current.value?.indexStatus,
  (status) => {
    if (status === 'indexing') resume();
    else pause();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  pause();
});

// Sources that an index run will actually push through LightRAG. Ones already
// indexed are only re-checked, so they cost nothing.
const toIndex = computed(() => {
  if (!current.value) return 0;
  return current.value.sourceCount - current.value.indexedCount;
});

const progressPercent = computed(() => {
  if (!current.value || current.value.sourceCount === 0) return 0;
  return Math.round(
    (current.value.indexedCount / current.value.sourceCount) * 100,
  );
});

async function handleIndex() {
  if (!current.value) return;

  // Re-indexing is what costs money (LLM over every unindexed document), and
  // people were pressing it "to be sure". Say exactly what will happen first.
  //
  // The count is a floor, not a promise: it is derived from what Ranch has
  // recorded, while the run asks LightRAG about every source and re-sends
  // whatever it no longer holds. After the LightRAG index is cleared this
  // dialog said "42 of 210" and then sent all 210, so the wording has to admit
  // that rather than quote a number it cannot guarantee.
  const total = current.value.sourceCount;
  // Sources LightRAG is still chunking are waited on, not re-sent, so they do
  // not belong in the "never confirmed" bucket that reads as work to redo.
  const processing = current.value.processingCount;
  const neverConfirmed = toIndex.value - current.value.failedCount - processing;
  const breakdown = [
    `${current.value.failedCount} failed earlier`,
    ...(processing > 0 ? [`${processing} still processing`] : []),
    `${neverConfirmed} never confirmed`,
  ].join(', ');
  const knownWork =
    toIndex.value === 0
      ? `All ${total} source${total === 1 ? ' is' : 's are'} marked indexed, so this run may only re-verify them.`
      : `At least ${toIndex.value} of ${total} source${total === 1 ? '' : 's'} will go through the LLM (${breakdown}).`;
  const description = `${knownWork} Every source is re-checked against LightRAG, and any it no longer holds is sent again - if the LightRAG index was cleared, that means all ${total}. This costs money and can take a while on a large base.`;

  const ok = await confirmStore.ask({
    title: `Index ${current.value.name}?`,
    description,
    confirmLabel: 'Start indexing',
    cancelLabel: 'Cancel',
  });
  if (!ok) return;

  indexing.value = true;
  indexError.value = null;
  try {
    await store.startIndex(current.value.id);
    await refresh();
    resume();
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    indexError.value = e?.response?.data?.message ?? e?.message ?? 'Index failed';
  } finally {
    indexing.value = false;
  }
}

const tabs = computed(() => [
  { to: `/knowledges/${knowledgeId.value}/edit`, label: 'General' },
  { to: `/knowledges/${knowledgeId.value}/sources`, label: 'Sources' },
  { to: `/knowledges/${knowledgeId.value}/graph`, label: 'Graph' },
  { to: `/knowledges/${knowledgeId.value}/query`, label: 'Query' },
]);

const indexDisabled = computed(
  () => current.value?.indexStatus === 'indexing' || indexing.value,
);

provide('knowledge-current', current);
provide('knowledge-refresh', refresh);
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink
      to="/knowledges"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      ← Back to Knowledges
    </NuxtLink>

    <div v-if="current" class="flex items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <h1 class="text-2xl font-semibold truncate">{{ current.name }}</h1>
        <div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <KnowledgeIndexStatusBadge :status="current.indexStatus" />
          <span>
            Indexed
            <span class="font-medium text-foreground">{{ current.indexedCount }}</span>
            / {{ current.sourceCount }}
          </span>
          <span
            v-if="current.processingCount"
            title="LightRAG is still chunking these. Nothing is wrong - run Index again once its pipeline drains."
          >
            · {{ current.processingCount }} still processing
          </span>
          <span v-if="current.failedCount" class="text-destructive">
            · {{ current.failedCount }} failed
          </span>
          <span v-if="current.indexError" class="text-destructive">
            {{ current.indexError }}
          </span>
        </div>
        <div
          v-if="current.indexStatus === 'indexing'"
          class="mt-2 h-1.5 w-full max-w-md overflow-hidden rounded bg-muted"
          :title="`${progressPercent}%`"
        >
          <div
            class="h-full bg-primary transition-all"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
      </div>
      <Button :disabled="indexDisabled" @click="handleIndex">
        {{ indexDisabled ? 'Indexing…' : 'Index' }}
      </Button>
    </div>

    <p v-if="indexError" class="text-xs text-destructive">{{ indexError }}</p>

    <nav class="flex gap-1 border-b">
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        active-class="border-primary text-foreground"
        class="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {{ tab.label }}
      </NuxtLink>
    </nav>

    <NuxtPage />
  </div>
</template>
