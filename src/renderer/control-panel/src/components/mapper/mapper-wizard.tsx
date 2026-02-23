import { useReducer } from 'react'
import type { ResolutionLayout } from '@shared/types'
import { StepCapture } from './step-capture'
import { StepAutoDetect } from './step-auto-detect'
import { StepAnchorCalibration } from './step-anchor-calibration'
import { StepVerify } from './step-verify'
import { StepSave } from './step-save'

export type WizardMode = 'user' | 'dev'

type WizardStep =
  | 'capture'
  | 'auto-detect'
  | 'anchor-calibration'
  | 'verify'
  | 'save'
  | 'done'

interface WizardState {
  step: WizardStep
  imageBase64: string | null
  imageWidth: number
  imageHeight: number
  layout: ResolutionLayout | null
  method: string
}

type WizardAction =
  | { type: 'CAPTURE'; imageBase64: string; width: number; height: number }
  | { type: 'GO_AUTO_DETECT' }
  | { type: 'USE_LAYOUT'; layout: ResolutionLayout; method: string }
  | { type: 'GO_ANCHOR' }
  | { type: 'CALIBRATION_DONE'; layout: ResolutionLayout }
  | { type: 'ACCEPT_VERIFY' }
  | { type: 'REDO_CALIBRATION' }
  | { type: 'GO_BACK_TO_VERIFY' }
  | { type: 'SAVED' }
  | { type: 'REPORT_SUBMITTED' }
  | { type: 'RESET' }

const initialState: WizardState = {
  step: 'capture',
  imageBase64: null,
  imageWidth: 0,
  imageHeight: 0,
  layout: null,
  method: '',
}

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'CAPTURE':
      return {
        ...state,
        imageBase64: action.imageBase64,
        imageWidth: action.width,
        imageHeight: action.height,
      }
    case 'GO_AUTO_DETECT':
      return { ...state, step: 'auto-detect' }
    case 'USE_LAYOUT':
      return { ...state, step: 'verify', layout: action.layout, method: action.method }
    case 'GO_ANCHOR':
      return { ...state, step: 'anchor-calibration' }
    case 'CALIBRATION_DONE':
      return { ...state, step: 'verify', layout: action.layout, method: 'anchor-calibrated' }
    case 'ACCEPT_VERIFY':
      return { ...state, step: 'save' }
    case 'REDO_CALIBRATION':
      return { ...state, step: 'auto-detect', layout: null, method: '' }
    case 'GO_BACK_TO_VERIFY':
      return { ...state, step: 'verify' }
    case 'SAVED':
      return { ...state, step: 'done' }
    case 'REPORT_SUBMITTED':
      return { ...state, step: 'done' }
    case 'RESET':
      return initialState
    default:
      return state
  }
}

interface MapperWizardProps {
  mode: WizardMode
  onDone: () => void
}

export function MapperWizard({ mode, onDone }: MapperWizardProps) {
  const [state, dispatch] = useReducer(reducer, initialState)

  switch (state.step) {
    case 'capture':
      return (
        <StepCapture
          mode={mode}
          imageBase64={state.imageBase64}
          imageWidth={state.imageWidth}
          imageHeight={state.imageHeight}
          onCapture={(imageBase64, width, height) =>
            dispatch({ type: 'CAPTURE', imageBase64, width, height })
          }
          onNext={() => dispatch({ type: 'GO_AUTO_DETECT' })}
        />
      )

    case 'auto-detect':
      return (
        <StepAutoDetect
          mode={mode}
          screenshotWidth={state.imageWidth}
          screenshotHeight={state.imageHeight}
          imageBase64={state.imageBase64!}
          onUseLayout={(layout, method) =>
            dispatch({ type: 'USE_LAYOUT', layout, method })
          }
          onCalibrate={() => dispatch({ type: 'GO_ANCHOR' })}
          onReportSubmitted={() => dispatch({ type: 'REPORT_SUBMITTED' })}
        />
      )

    case 'anchor-calibration':
      return (
        <StepAnchorCalibration
          imageBase64={state.imageBase64!}
          imageWidth={state.imageWidth}
          imageHeight={state.imageHeight}
          onComplete={(layout) =>
            dispatch({ type: 'CALIBRATION_DONE', layout })
          }
          onBack={() => dispatch({ type: 'REDO_CALIBRATION' })}
        />
      )

    case 'verify':
      return (
        <StepVerify
          mode={mode}
          imageBase64={state.imageBase64!}
          imageWidth={state.imageWidth}
          imageHeight={state.imageHeight}
          layout={state.layout!}
          onAccept={() => dispatch({ type: 'ACCEPT_VERIFY' })}
          onRedo={() => dispatch({ type: 'REDO_CALIBRATION' })}
          onReportSubmitted={() => dispatch({ type: 'REPORT_SUBMITTED' })}
        />
      )

    case 'save':
      return (
        <StepSave
          resolution={`${state.imageWidth}x${state.imageHeight}`}
          layout={state.layout!}
          method={state.method}
          onSaved={() => dispatch({ type: 'SAVED' })}
          onBack={() => dispatch({ type: 'GO_BACK_TO_VERIFY' })}
        />
      )

    case 'done':
      onDone()
      return null
  }
}
