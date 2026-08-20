import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FlaskConical,
  Play,
  Eye,
  UploadCloud,
  Rocket,
  Loader2,
  AlertTriangle,
  X,
  FileChartColumn,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/hooks/use-app-store'
import type { Hero } from '@shared/types'

// Dev-only cockpit for the retraining loop: gather (via the sibling
// ad_data_gather_script repo) — either for detected model gaps or for
// explicitly targeted heroes (icon reworks) — upload dataset to S3,
// dispatch the cloud retrain workflow. Rendered only in unpackaged builds.
export function MlPipelineCard() {
  const { t } = useTranslation('data')
  const mlModelGaps = useAppStore((s) => s.mlModelGaps)
  const gapCount = mlModelGaps?.missingFromModel.length ?? 0

  const [busy, setBusy] = useState(false)
  const [dryRunOutput, setDryRunOutput] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [datasetVersion, setDatasetVersion] = useState('')
  const [fineTune, setFineTune] = useState(false)

  // Targeted gather (--heroes mode)
  const [allHeroes, setAllHeroes] = useState<Hero[]>([])
  const [heroFilter, setHeroFilter] = useState('')
  const [targetHeroes, setTargetHeroes] = useState<Hero[]>([])
  const [purgeExisting, setPurgeExisting] = useState(false)

  // Model-tile gather + recognition diagnostics
  const [modelsSets, setModelsSets] = useState('24')
  const [diagIterations, setDiagIterations] = useState('3')
  const [diagPickTime, setDiagPickTime] = useState('0')

  useEffect(() => {
    window.electronApi.invoke('hero:getAll').then(setAllHeroes).catch(() => {})
  }, [])

  const heroSuggestions = useMemo(() => {
    const query = heroFilter.trim().toLowerCase()
    if (!query) return []
    const chosen = new Set(targetHeroes.map((h) => h.name))
    return allHeroes
      .filter(
        (h) =>
          !chosen.has(h.name) &&
          (h.name.includes(query) || h.displayName.toLowerCase().includes(query)),
      )
      .slice(0, 6)
  }, [allHeroes, heroFilter, targetHeroes])

  const runGather = async (
    dryRun: boolean,
    options?: { heroes: string[]; purgeExisting: boolean },
  ) => {
    if (!dryRun) {
      const confirmText = options?.purgeExisting
        ? `${t('mlPipeline.gatherConfirm')}\n\n${t('mlPipeline.heroGatherPurgeConfirm')}`
        : t('mlPipeline.gatherConfirm')
      if (!window.confirm(confirmText)) return
    }
    setBusy(true)
    setMessage(dryRun ? { text: t('mlPipeline.dryRunRunning'), error: false } : null)
    if (dryRun) setDryRunOutput(null)
    try {
      const result = await window.electronApi.invoke('dev:runGatherScript', {
        dryRun,
        ...options,
      })
      if (dryRun && result.output) setDryRunOutput(result.output)
      setMessage({
        text: result.success
          ? dryRun
            ? t('mlPipeline.dryRunDone')
            : (result.output ?? t('mlPipeline.gatherLaunched'))
          : (result.error ?? 'Unknown error'),
        error: !result.success,
      })
    } finally {
      setBusy(false)
    }
  }

  const runTargetedGather = (dryRun: boolean) =>
    runGather(dryRun, {
      heroes: targetHeroes.map((h) => h.name),
      purgeExisting,
    })

  const runModelsGather = async (dryRun: boolean) => {
    if (!dryRun && !window.confirm(t('mlPipeline.gatherConfirm'))) return
    setBusy(true)
    setMessage(dryRun ? { text: t('mlPipeline.dryRunRunning'), error: false } : null)
    if (dryRun) setDryRunOutput(null)
    try {
      const result = await window.electronApi.invoke('dev:runModelsGather', {
        dryRun,
        sets: Number(modelsSets) || 24,
      })
      if (dryRun && result.output) setDryRunOutput(result.output)
      setMessage({
        text: result.success
          ? dryRun
            ? t('mlPipeline.dryRunDone')
            : (result.output ?? '')
          : (result.error ?? 'Unknown error'),
        error: !result.success,
      })
    } finally {
      setBusy(false)
    }
  }

  const runDiagnostics = async (dryRun: boolean) => {
    if (!dryRun && !window.confirm(t('mlPipeline.diagnosticConfirm'))) return
    setBusy(true)
    setMessage(dryRun ? { text: t('mlPipeline.dryRunRunning'), error: false } : null)
    if (dryRun) setDryRunOutput(null)
    try {
      const result = await window.electronApi.invoke('dev:runDiagnosticCycle', {
        dryRun,
        iterations: Number(diagIterations) >= 0 ? Number(diagIterations) : 3,
        pickTimeS: Number(diagPickTime) >= 0 ? Number(diagPickTime) : 0,
      })
      if (dryRun && result.output) setDryRunOutput(result.output)
      setMessage({
        text: result.success
          ? dryRun
            ? t('mlPipeline.dryRunDone')
            : (result.output ?? '')
          : (result.error ?? 'Unknown error'),
        error: !result.success,
      })
    } finally {
      setBusy(false)
    }
  }

  const analyzeDiagnostics = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await window.electronApi.invoke('dev:analyzeDiagnostics')
      setMessage({
        text: result.success
          ? t('mlPipeline.diagnosticAnalyzed')
          : (result.error ?? 'Unknown error'),
        error: !result.success,
      })
    } finally {
      setBusy(false)
    }
  }

  const uploadDataset = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await window.electronApi.invoke('dev:uploadDataset')
      setMessage({
        text: result.success ? t('mlPipeline.uploadLaunched') : (result.error ?? 'Unknown error'),
        error: !result.success,
      })
    } finally {
      setBusy(false)
    }
  }

  const triggerRetrain = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await window.electronApi.invoke('dev:triggerRetrain', {
        datasetVersion,
        fineTune,
      })
      setMessage({
        text: result.success
          ? t('mlPipeline.retrainDispatched', { version: datasetVersion })
          : (result.error ?? 'Unknown error'),
        error: !result.success,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5" />
          {t('mlPipeline.title')}
        </CardTitle>
        <CardDescription>{t('mlPipeline.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Step 1: gather */}
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {t('mlPipeline.gatherStep', { count: gapCount })}
          </p>
          <div className="flex items-start gap-2 text-sm text-yellow-600 dark:text-yellow-400">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>{t('mlPipeline.gatherWarning')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || gapCount === 0}
              onClick={() => runGather(true)}
            >
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Eye className="h-4 w-4 mr-1" />}
              {t('mlPipeline.dryRunButton')}
            </Button>
            <Button
              size="sm"
              disabled={busy || gapCount === 0}
              onClick={() => runGather(false)}
            >
              <Play className="h-4 w-4 mr-1" />
              {t('mlPipeline.gatherButton')}
            </Button>
          </div>
          {/* Targeted gather: re-collect specific heroes (icon reworks) */}
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">{t('mlPipeline.heroGatherTitle')}</p>
            <p className="text-sm text-muted-foreground">
              {t('mlPipeline.heroGatherDescription')}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {targetHeroes.map((hero) => (
                <Badge key={hero.name} variant="secondary" className="gap-1">
                  {hero.displayName}
                  <button
                    type="button"
                    aria-label={t('mlPipeline.heroRemove', { hero: hero.displayName })}
                    onClick={() =>
                      setTargetHeroes((prev) => prev.filter((h) => h.name !== hero.name))
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <Input
                className="h-8 w-44"
                placeholder={t('mlPipeline.heroSearchPlaceholder')}
                value={heroFilter}
                onChange={(e) => setHeroFilter(e.target.value)}
              />
            </div>
            {heroSuggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {heroSuggestions.map((hero) => (
                  <Button
                    key={hero.name}
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={() => {
                      setTargetHeroes((prev) => [...prev, hero])
                      setHeroFilter('')
                    }}
                  >
                    {hero.displayName}
                  </Button>
                ))}
              </div>
            )}
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={purgeExisting}
                onChange={(e) => setPurgeExisting(e.target.checked)}
              />
              {t('mlPipeline.heroPurgeLabel')}
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || targetHeroes.length === 0}
                onClick={() => runTargetedGather(true)}
              >
                {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Eye className="h-4 w-4 mr-1" />}
                {t('mlPipeline.dryRunButton')}
              </Button>
              <Button
                size="sm"
                disabled={busy || targetHeroes.length === 0}
                onClick={() => runTargetedGather(false)}
              >
                <Play className="h-4 w-4 mr-1" />
                {t('mlPipeline.heroGatherButton')}
              </Button>
            </div>
          </div>

          {/* Model-tile gather: reference images for model recognition */}
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">{t('mlPipeline.modelsGatherTitle')}</p>
            <p className="text-sm text-muted-foreground">
              {t('mlPipeline.modelsGatherDescription')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm">
                {t('mlPipeline.modelsSetsLabel')}
                <Input
                  className="h-8 w-20"
                  type="number"
                  min={1}
                  max={100}
                  value={modelsSets}
                  onChange={(e) => setModelsSets(e.target.value)}
                />
              </label>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => runModelsGather(true)}
              >
                {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Eye className="h-4 w-4 mr-1" />}
                {t('mlPipeline.dryRunButton')}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => runModelsGather(false)}>
                <Play className="h-4 w-4 mr-1" />
                {t('mlPipeline.modelsGatherButton')}
              </Button>
            </div>
          </div>

          {/* Recognition diagnostics: full bot drafts + report */}
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">{t('mlPipeline.diagnosticTitle')}</p>
            <p className="text-sm text-muted-foreground">
              {t('mlPipeline.diagnosticDescription')}
            </p>
            <div className="flex items-start gap-2 text-sm text-yellow-600 dark:text-yellow-400">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>{t('mlPipeline.diagnosticKeepAppOpen')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm">
                {t('mlPipeline.diagnosticIterationsLabel')}
                <Input
                  className="h-8 w-20"
                  type="number"
                  min={0}
                  max={50}
                  value={diagIterations}
                  onChange={(e) => setDiagIterations(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                {t('mlPipeline.diagnosticPickTimeLabel')}
                <Input
                  className="h-8 w-20"
                  type="number"
                  min={0}
                  max={120}
                  value={diagPickTime}
                  onChange={(e) => setDiagPickTime(e.target.value)}
                />
              </label>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => runDiagnostics(true)}
              >
                {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Eye className="h-4 w-4 mr-1" />}
                {t('mlPipeline.dryRunButton')}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => runDiagnostics(false)}>
                <Play className="h-4 w-4 mr-1" />
                {t('mlPipeline.diagnosticRunButton')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={analyzeDiagnostics}
              >
                <FileChartColumn className="h-4 w-4 mr-1" />
                {t('mlPipeline.diagnosticAnalyzeButton')}
              </Button>
            </div>
          </div>

          {dryRunOutput && (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
              {dryRunOutput}
            </pre>
          )}
        </div>

        {/* Step 2: upload */}
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('mlPipeline.uploadStep')}</p>
          <Button variant="outline" size="sm" disabled={busy} onClick={uploadDataset}>
            <UploadCloud className="h-4 w-4 mr-1" />
            {t('mlPipeline.uploadButton')}
          </Button>
        </div>

        {/* Step 3: retrain */}
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('mlPipeline.retrainStep')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-32"
              placeholder={t('mlPipeline.versionPlaceholder')}
              value={datasetVersion}
              onChange={(e) => setDatasetVersion(e.target.value)}
            />
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={fineTune}
                onChange={(e) => setFineTune(e.target.checked)}
              />
              {t('mlPipeline.fineTuneLabel')}
            </label>
            <Button
              size="sm"
              disabled={busy || datasetVersion.trim() === ''}
              onClick={triggerRetrain}
            >
              <Rocket className="h-4 w-4 mr-1" />
              {t('mlPipeline.retrainButton')}
            </Button>
          </div>
        </div>

        {message && (
          <p className={`text-sm ${message.error ? 'text-destructive' : 'text-muted-foreground'}`}>
            {message.text}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
