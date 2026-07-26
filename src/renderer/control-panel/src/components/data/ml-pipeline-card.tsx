import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FlaskConical,
  Play,
  Eye,
  UploadCloud,
  Rocket,
  Loader2,
  AlertTriangle,
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
import { useAppStore } from '@/hooks/use-app-store'

// Dev-only cockpit for the retraining loop: gather (via the sibling
// ad_data_gather_script repo), upload dataset to S3, dispatch the cloud
// retrain workflow. Rendered only in unpackaged builds.
export function MlPipelineCard() {
  const { t } = useTranslation('data')
  const mlModelGaps = useAppStore((s) => s.mlModelGaps)
  const gapCount = mlModelGaps?.missingFromModel.length ?? 0

  const [busy, setBusy] = useState(false)
  const [dryRunOutput, setDryRunOutput] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [datasetVersion, setDatasetVersion] = useState('')
  const [fineTune, setFineTune] = useState(false)

  const runGather = async (dryRun: boolean) => {
    if (!dryRun && !window.confirm(t('mlPipeline.gatherConfirm'))) return
    setBusy(true)
    setMessage(null)
    if (dryRun) setDryRunOutput(null)
    try {
      const result = await window.electronApi.invoke('dev:runGatherScript', { dryRun })
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
