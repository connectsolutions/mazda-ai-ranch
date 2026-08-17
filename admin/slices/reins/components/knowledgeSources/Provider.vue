<script setup lang="ts">
import { refDebounced, useIntervalFn } from '@vueuse/core';
import type {
  IImportJob,
  IKnowledge,
  ISource,
  ISourceFilter,
  SourceIndexStatus,
  SourceType,
} from '#reins/stores/knowledge';
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#theme/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#theme/components/ui/table';

const route = useRoute();
const store = useKnowledgeStore();
const confirmStore = useConfirmStore();
const current = inject<Ref<IKnowledge | null>>('knowledge-current');
const refresh = inject<() => Promise<void>>('knowledge-refresh');

const knowledgeId = computed(() => route.params.id as string);

// ---- filters ---------------------------------------------------------------

const PER_PAGE = 50;
const STATUS_OPTIONS: { value: SourceIndexStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'indexed', label: 'Indexed' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
];
const TYPE_OPTIONS: { value: SourceType | 'all'; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'file', label: 'File' },
  { value: 'url', label: 'URL' },
  { value: 'text', label: 'Text' },
];

const search = ref('');
const searchDebounced = refDebounced(search, 300);
const status = ref<SourceIndexStatus | 'all'>('all');
const type = ref<SourceType | 'all'>('all');
const page = ref(1);

const filter = computed<ISourceFilter>(() => ({
  page: page.value,
  perPage: PER_PAGE,
  search: searchDebounced.value.trim() || undefined,
  status: status.value === 'all' ? undefined : status.value,
  type: type.value === 'all' ? undefined : type.value,
}));

// Any filter change starts from page 1 again.
watch([searchDebounced, status, type], () => {
  page.value = 1;
});

const {
  data: pageData,
  pending,
  refresh: reloadPage,
} = await useAsyncData(
  () => `knowledge-sources-${knowledgeId.value}`,
  () => store.listSources(knowledgeId.value, filter.value),
  { watch: [filter] },
);

const rows = computed<ISource[]>(() => pageData.value?.items ?? []);
const total = computed(() => pageData.value?.total ?? 0);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PER_PAGE)));

// A run that finishes mid-way can shrink a filtered result set under the
// current page; snap back instead of showing an empty page.
watch(pageCount, (count) => {
  if (page.value > count) page.value = count;
});

const hasFilter = computed(
  () => search.value.trim() !== '' || status.value !== 'all' || type.value !== 'all',
);

// ---- background imports ----------------------------------------------------

const imports = ref<IImportJob[]>([]);

async function reloadImports() {
  try {
    imports.value = await store.listImports(knowledgeId.value);
  } catch {
    // Progress is a nicety; a failed poll must not break the page.
  }
}

await reloadImports();

const importRunning = computed(() =>
  imports.value.some((j) => j.status === 'running'),
);
const indexing = computed(() => current?.value?.indexStatus === 'indexing');

// While something is moving (index run, archive import) the list changes
// underneath the user, so keep it fresh; go quiet the moment it stops.
const { pause, resume } = useIntervalFn(
  async () => {
    await Promise.all([reloadPage(), reloadImports()]);
    if (indexing.value && refresh) await refresh();
  },
  3000,
  { immediate: false },
);

watch(
  [indexing, importRunning],
  ([isIndexing, isImporting]) => {
    if (isIndexing || isImporting) resume();
    else pause();
  },
  { immediate: true },
);

onBeforeUnmount(pause);

// ---- actions ---------------------------------------------------------------

const previewing = ref<ISource | null>(null);

async function handleDelete(source: ISource) {
  const ok = await confirmStore.ask({
    title: 'Delete source?',
    description: `Permanently delete source "${source.name}"? This cannot be undone.`,
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    variant: 'destructive',
  });
  if (!ok) return;
  await store.removeSource(knowledgeId.value, source.id);
  await reloadPage();
  if (refresh) await refresh();
}

async function handleDownload(source: ISource) {
  await store.downloadSource(knowledgeId.value, source.id);
}

async function onAdded() {
  await Promise.all([reloadPage(), reloadImports()]);
  if (refresh) await refresh();
}

// ---- formatting ------------------------------------------------------------

function formatBytes(size: number | null): string {
  if (size === null) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString();
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <KnowledgeSourcesAddForm :knowledge-id="knowledgeId" @added="onAdded" />

    <KnowledgeSourcesAddFromSitemapForm
      :knowledge-id="knowledgeId"
      @added="onAdded"
    />

    <KnowledgeSourcesAddFromArchiveForm
      :knowledge-id="knowledgeId"
      @added="onAdded"
    />

    <KnowledgeSourcesImportProgress :jobs="imports" />

    <div class="flex flex-wrap items-center gap-2">
      <Input
        v-model="search"
        placeholder="Search by name…"
        class="w-64"
      />
      <Select v-model="status">
        <SelectTrigger class="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="o in STATUS_OPTIONS" :key="o.value" :value="o.value">
            {{ o.label }}
          </SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="type">
        <SelectTrigger class="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="o in TYPE_OPTIONS" :key="o.value" :value="o.value">
            {{ o.label }}
          </SelectItem>
        </SelectContent>
      </Select>
      <span class="ml-auto text-sm text-muted-foreground">
        {{ total }} source{{ total === 1 ? '' : 's' }}
        <template v-if="pending"> · updating…</template>
      </span>
    </div>

    <div v-if="rows.length" class="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead class="w-20">Type</TableHead>
            <TableHead class="w-24">Size</TableHead>
            <TableHead class="w-48">Status</TableHead>
            <TableHead class="w-28">Added</TableHead>
            <TableHead class="w-56 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="s in rows" :key="s.id">
            <TableCell class="max-w-md font-medium">
              <a
                v-if="s.type === 'url' && s.url"
                :href="s.url"
                target="_blank"
                rel="noopener"
                class="block truncate underline-offset-2 hover:underline"
                :title="s.url"
              >
                {{ s.name }}
              </a>
              <span v-else class="block truncate" :title="s.name">{{ s.name }}</span>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ s.type }}</TableCell>
            <TableCell class="text-muted-foreground">{{ formatBytes(s.sizeBytes) }}</TableCell>
            <TableCell>
              <div class="flex flex-col gap-1">
                <KnowledgeSourceStatusBadge :status="s.indexStatus" class="w-fit" />
                <span
                  v-if="s.indexStatus === 'failed' && s.indexError"
                  class="line-clamp-2 text-xs text-destructive"
                  :title="s.indexError"
                >
                  {{ s.indexError }}
                </span>
              </div>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ formatDate(s.createdAt) }}</TableCell>
            <TableCell class="text-right">
              <div class="flex justify-end gap-1">
                <Button
                  v-if="s.type !== 'url'"
                  size="sm"
                  variant="ghost"
                  @click="previewing = s"
                >
                  View
                </Button>
                <Button
                  v-if="s.type !== 'url'"
                  size="sm"
                  variant="ghost"
                  @click="handleDownload(s)"
                >
                  Download
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  class="text-destructive"
                  @click="handleDelete(s)"
                >
                  Delete
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div
      v-else-if="!pending"
      class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
    >
      <template v-if="hasFilter">No sources match these filters.</template>
      <template v-else>No sources yet. Add one above, then run Index.</template>
    </div>

    <div v-if="pageCount > 1" class="flex items-center justify-end gap-2 text-sm">
      <span class="text-muted-foreground">
        Page {{ page }} of {{ pageCount }} · {{ total }} total
      </span>
      <Button size="sm" variant="outline" :disabled="page <= 1" @click="page--">
        Prev
      </Button>
      <Button size="sm" variant="outline" :disabled="page >= pageCount" @click="page++">
        Next
      </Button>
    </div>

    <KnowledgeSourcesPreviewSheet
      :knowledge-id="knowledgeId"
      :source="previewing"
      @close="previewing = null"
    />
  </div>
</template>
