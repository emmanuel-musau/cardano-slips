"use client"

/**
 * The slip page: one link in, one card on screen, and every state from there to
 * a receipt — `8 · Page states`, `9 · Wallet connect` and `10 · Signing and outcomes`.
 */
import { fillLabel } from "@cardano-slips/core"
import {
  type Attempt,
  type BalancingParameters,
  discoverWallets,
  EffectsPanel,
  type FetchedSlip,
  fetchSlip,
  type Outcome,
  OutcomePanel,
  type Progress,
  type Receipt,
  SlipCard,
  SlipCardSkeleton,
  type SlipSubmission,
  SlipReceipt
} from "@cardano-slips/flow"
import { Effect, Either } from "effect"
import { useEffect, useRef, useState } from "react"

import { Chrome } from "./chrome.js"
import { NoticeCard } from "./notice-card.js"
import {
  insecureLink,
  maxRetries,
  noLink,
  type Notice,
  noticeFor,
  noWallet,
  pageFault,
  retryDelay,
  serverBuild
} from "./notices.js"
import { explorerFor, runSlip } from "./run.js"
import { type Screen, screenFor } from "./screens.js"
import { WalletPicker } from "./wallet-picker.js"

type Loading =
  | { readonly _tag: "Resolving" }
  | { readonly _tag: "Ready"; readonly fetched: FetchedSlip }
  | { readonly _tag: "Failed"; readonly notice: Notice; readonly retryAfter?: number }

/** Where the person is once the card is on screen. */
type Step =
  | { readonly _tag: "Card"; readonly rejected?: Extract<Screen, { _tag: "Card" }>["rejected"] }
  | { readonly _tag: "Choosing"; readonly submission: SlipSubmission }
  | { readonly _tag: "Building"; readonly submission: SlipSubmission }
  | { readonly _tag: "Preview"; readonly attempt: Attempt }
  | { readonly _tag: "Outcome"; readonly outcome: Outcome; readonly attempt: Attempt }
  | { readonly _tag: "Blocked"; readonly screen: Extract<Screen, { _tag: "Blocked" }> }
  | { readonly _tag: "Notice"; readonly notice: Notice; readonly retryAfter?: number }
  | { readonly _tag: "Receipt"; readonly receipt: Receipt; readonly attempt: Attempt }

type Target = { readonly host: string; readonly site: string }

/** How long the funds-moved state stays on screen before the rebuilt transaction replaces it. */
const rebuildPause = 1_500

const targetOf = (link: string | undefined): Target | undefined => {
  if (link === undefined) return undefined
  try {
    const url = new URL(link)
    return { host: url.host, site: url.origin }
  } catch {
    return undefined
  }
}

/** Counts down once a second from `seconds`, and restarts whenever `seconds` changes. */
const useCountdown = (seconds: number): number => {
  const [left, setLeft] = useState(seconds)
  const [from, setFrom] = useState(seconds)
  if (from !== seconds) {
    setFrom(seconds)
    setLeft(seconds)
  }
  useEffect(() => {
    if (left <= 0) return
    const timer = setTimeout(() => setLeft((value) => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [left])
  return left
}

export type SlipPageProps = {
  /** The Slip link, from the page's own `?uri=`. */
  readonly link: string | undefined
  /** Where `cardano` lives. Defaults to the browser's `window`; a test hands in a stand-in. */
  readonly walletHost?: unknown
  /** Figures to use instead of asking this page's server; see `resolveParameters`. */
  readonly parameters?: BalancingParameters
}

export const SlipPage = ({ link, parameters, walletHost }: SlipPageProps): React.JSX.Element => {
  const target = targetOf(link)
  const [loading, setLoading] = useState<Loading>({ _tag: "Resolving" })
  const [reads, setReads] = useState(0)
  // A re-read the endpoint asked for: no retry spent, and the card stays up so typed answers survive.
  const [rereads, setRereads] = useState(0)
  const quietly = useRef(false)
  const [step, setStep] = useState<Step>({ _tag: "Card" })
  const [runs, setRuns] = useState(0)
  const [wallet, setWallet] = useState<{ readonly key: string; readonly name: string } | undefined>(undefined)
  // Remembered across steps so "Try again" and "Review and sign again" repeat the same press.
  const [submitted, setSubmitted] = useState<SlipSubmission | undefined>(undefined)
  const answer = useRef<((agreed: boolean) => void) | undefined>(undefined)
  const running = useRef<AbortController | undefined>(undefined)

  useEffect(() => {
    if (link === undefined) return
    const controller = new AbortController()
    if (!quietly.current) setLoading({ _tag: "Resolving" })
    quietly.current = false
    setStep({ _tag: "Card" })
    void Effect.runPromise(Effect.either(fetchSlip(link)), { signal: controller.signal }).then(
      (result) => {
        if (Either.isRight(result)) {
          setLoading({ _tag: "Ready", fetched: result.right })
          return
        }
        const failure = result.left
        setLoading(
          failure._tag === "InsecureSlipUrl"
            ? { _tag: "Failed", notice: insecureLink }
            : {
                _tag: "Failed",
                notice: noticeFor(failure, targetOf(link)?.host ?? link),
                ...(failure.retryAfter === undefined ? {} : { retryAfter: failure.retryAfter })
              }
        )
      },
      // Aborted: the link changed or a retry started, and the newer request owns the view.
      () => {
        if (!controller.signal.aborted) setLoading({ _tag: "Failed", notice: pageFault })
      }
    )
    return () => controller.abort()
  }, [link, reads, rereads])

  // A run in flight when the page goes away must not go on to ask for a signature.
  useEffect(() => () => running.current?.abort(), [])

  const readWait = useCountdown(loading._tag === "Failed" ? retryDelay(reads, loading.retryAfter) : 0)
  const runWait = useCountdown(step._tag === "Notice" ? retryDelay(runs, step.retryAfter) : 0)

  if (link === undefined) {
    return (
      <Chrome host={undefined} network={undefined}>
        <NoticeCard notice={noLink} host={undefined} site={undefined} />
      </Chrome>
    )
  }

  if (loading._tag === "Resolving") {
    return (
      <Chrome host={target?.host} network={undefined}>
        <SlipCardSkeleton />
      </Chrome>
    )
  }

  if (loading._tag === "Failed") {
    return (
      <Chrome host={target?.host} network={undefined}>
        <NoticeCard
          notice={loading.notice}
          host={target?.host}
          site={target?.site}
          retryIn={readWait}
          {...(reads < maxRetries ? { onRetry: () => setReads((count) => count + 1) } : {})}
        />
      </Chrome>
    )
  }

  const { discoveryUrl, slip } = loading.fetched
  const host = target?.host ?? ""
  const network = slip.network
  const walletsHost = walletHost ?? globalThis

  const backToCard = (): void => {
    running.current?.abort()
    answer.current = undefined
    setRuns(0)
    setStep({ _tag: "Card" })
  }

  const run = (submission: SlipSubmission, chosen: { readonly key: string; readonly name: string }): void => {
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    setWallet(chosen)
    setStep({ _tag: "Building", submission })

    let latest: Attempt | undefined
    const outcome = (value: Outcome): void => {
      if (latest !== undefined) setStep({ _tag: "Outcome", outcome: value, attempt: latest })
    }
    const progress = (value: Progress): void => {
      if (value._tag === "Signing") outcome({ _tag: "Waiting", wallet: chosen.name })
      else if (value._tag === "Submitting") outcome({ _tag: "Submitting", transactionId: value.transactionId })
      else outcome({ _tag: "Rebuilding", number: value.number, of: value.of })
    }

    const program = runSlip(
      {
        submission,
        network,
        walletKey: chosen.key,
        ...(walletHost === undefined ? {} : { host: walletHost }),
        ...(parameters === undefined ? {} : { parameters })
      },
      {
        onAttempt: (attempt) => {
          latest = attempt
          if (attempt.number === 1) {
            setStep({ _tag: "Preview", attempt })
            return
          }
          // A rebuild takes a moment, and a second preview that replaced the first
          // unseen would read as the same transaction. The funds-moved state stays
          // long enough to be read; the wallet cannot be asked before Sign either way.
          setTimeout(() => {
            if (!controller.signal.aborted) setStep({ _tag: "Preview", attempt })
          }, rebuildPause)
        },
        confirm: () =>
          new Promise<boolean>((settle) => {
            answer.current = settle
          }),
        onProgress: progress
      }
    )

    void Effect.runPromise(Effect.either(program), { signal: controller.signal }).then(
      (result) => {
        answer.current = undefined
        if (Either.isRight(result)) {
          if (latest !== undefined) setStep({ _tag: "Receipt", receipt: result.right, attempt: latest })
          return
        }
        const fields = submission.action.parameters?.map((parameter) => parameter.name) ?? []
        const screen = screenFor(result.left, { host, network, fields })
        switch (screen._tag) {
          case "Card":
            setStep({ _tag: "Card", ...(screen.rejected === undefined ? {} : { rejected: screen.rejected }) })
            return
          case "Refetch":
            quietly.current = true
            setRereads((count) => count + 1)
            return
          case "Notice":
            setStep({
              _tag: "Notice",
              notice: screen.notice,
              ...(screen.retryAfter === undefined ? {} : { retryAfter: screen.retryAfter })
            })
            return
          case "Blocked":
            setStep({ _tag: "Blocked", screen })
            return
          case "Outcome":
            if (latest === undefined) setStep({ _tag: "Card" })
            else setStep({ _tag: "Outcome", outcome: screen.outcome, attempt: latest })
        }
      },
      () => {
        answer.current = undefined
        if (!controller.signal.aborted) setStep({ _tag: "Notice", notice: pageFault })
      }
    )
  }

  const choose = (submission: SlipSubmission): void => {
    setSubmitted(submission)
    if (slip.build === "server") {
      setStep({ _tag: "Notice", notice: serverBuild })
      return
    }
    setStep({ _tag: "Choosing", submission })
  }

  // A fresh press after a decline, a refusal or a rebuild starts a fresh count; only a notice's retry adds to it.
  const again = (retry = false): void => {
    if (submitted === undefined || wallet === undefined) {
      backToCard()
      return
    }
    setRuns((count) => (retry ? count + 1 : 0))
    run(submitted, wallet)
  }

  const wallets = step._tag === "Choosing" ? discoverWallets(walletsHost) : []
  const claim = submitted === undefined ? slip.title : fillLabel(submitted.action, submitted.values)
  const cardShown = step._tag === "Card" || step._tag === "Building"

  return (
    <Chrome host={host} network={network}>
      {/* Kept mounted while other steps show, so an answer typed into the card survives the round trip. */}
      <div className="page__card" hidden={!cardShown}>
        <SlipCard
          slip={slip}
          discoveryUrl={discoveryUrl}
          onSubmit={choose}
          busy={step._tag === "Building"}
          {...(step._tag === "Card" && step.rejected !== undefined ? { rejected: step.rejected } : {})}
        />
      </div>

      {step._tag === "Choosing" && wallets.length === 0 ? (
        <NoticeCard notice={noWallet} host={host} site={target?.site} onBack={backToCard} />
      ) : undefined}

      {step._tag === "Choosing" && wallets.length > 0 ? (
        <WalletPicker
          claim={claim}
          host={host}
          wallets={wallets}
          onBack={backToCard}
          onPick={(key) => {
            const picked = wallets.find((one) => one.key === key)
            if (picked !== undefined) run(step.submission, { key, name: picked.name })
          }}
        />
      ) : undefined}

      {step._tag === "Preview" ? (
        <EffectsPanel
          claim={claim}
          description={slip.description}
          origin={host}
          derived={step.attempt}
          verdict={{ _tag: "match" }}
          onSign={() => answer.current?.(true)}
          onCancel={() => answer.current?.(false)}
          onRebuild={() => again()}
        />
      ) : undefined}

      {step._tag === "Blocked" ? (
        <EffectsPanel
          claim={claim}
          description={slip.description}
          origin={host}
          derived={step.screen.derived}
          verdict={{ _tag: "mismatch", reasons: step.screen.reasons }}
          onCancel={backToCard}
        />
      ) : undefined}

      {step._tag === "Outcome" ? (
        <OutcomePanel
          claim={claim}
          derived={step.attempt}
          outcome={step.outcome}
          onClose={backToCard}
          onAgain={() => again()}
        />
      ) : undefined}

      {step._tag === "Receipt" ? (
        <SlipReceipt
          claim={claim}
          derived={step.attempt}
          transactionId={step.receipt.transactionId}
          network={network}
          explorer={explorerFor(network, step.receipt.transactionId)}
        />
      ) : undefined}

      {step._tag === "Notice" ? (
        <NoticeCard
          notice={step.notice}
          host={host}
          site={target?.site}
          retryIn={runWait}
          onBack={backToCard}
          {...(runs < maxRetries ? { onRetry: () => again(true) } : {})}
        />
      ) : undefined}
    </Chrome>
  )
}
