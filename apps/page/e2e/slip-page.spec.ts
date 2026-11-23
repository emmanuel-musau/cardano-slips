import type { Page } from "@playwright/test"
import { expect, expectSignedBy, test, type WalletOptions } from "cip30-test-wallet/playwright"

const examples = "http://localhost:4011"

const linkTo = (slip: "tip" | "delegate"): string => `/?uri=${encodeURIComponent(`${examples}/${slip}`)}`

/** Preview's figures, the ones the test wallet's ledger checks with, as the page's own route hands them over. */
const previewParameters = {
  stakeDeposit: "2000000",
  poolDeposit: "500000000",
  drepDeposit: "500000000",
  governanceActionDeposit: "1000000000",
  minFeeCoefficient: "44",
  minFeeConstant: "155381",
  coinsPerUtxoByte: "4310",
  maxTxSize: 16_384
}

/** Preview has no Byron era, so its slot is the seconds since its system start. */
const previewSlotNow = (): number => Math.floor((Date.now() - 1_666_656_000_000) / 1_000)

const answerParameters = (page: Page) =>
  page.route("**/parameters/preview", (route) => route.fulfill({ json: previewParameters }))

const wallet: WalletOptions = {
  name: "chw",
  displayName: "Test Wallet",
  networkId: 0,
  utxos: [{ lovelace: 50_000_000 }]
}

test.describe("a wallet that signs", () => {
  test.use({
    walletOptions: { ...wallet, ledger: { checks: true, currentSlot: previewSlotNow(), network: "preview" } }
  })

  test("tips from the link to a receipt, with a transaction the wallet really signed", async ({ page, wallet }) => {
    await answerParameters(page)
    await page.goto(linkTo("tip"))

    await page.getByRole("button", { name: "Tip 5 ADA" }).click()
    await page.getByRole("button", { name: /Test Wallet/ }).click()
    await page.getByRole("button", { name: "Sign transaction" }).click()

    await expect(page.getByText("Sent to Preview")).toBeVisible()
    expect(await wallet.calls("signTx")).toHaveLength(1)
    const submitted = await wallet.lastSubmittedTx()
    expect(submitted).toBeDefined()
    expectSignedBy(submitted!, wallet)
  })

  test("registers the stake key and delegates, and the ledger accepts the deposit", async ({ page, wallet }) => {
    await answerParameters(page)
    await page.goto(linkTo("delegate"))

    await page.getByRole("button", { name: "Delegate" }).click()
    await page.getByRole("button", { name: /Test Wallet/ }).click()
    await page.getByRole("button", { name: "Sign transaction" }).click()

    await expect(page.getByText("Sent to Preview")).toBeVisible()
    const submitted = await wallet.lastSubmittedTx()
    expect(submitted).toBeDefined()
    expectSignedBy(submitted!, wallet, { roles: ["payment", "stake"] })
  })
})

test.describe("a person who declines", () => {
  test.use({ walletOptions: { ...wallet, quirks: { signRejected: true } } })

  test("is told they declined, and nothing is submitted", async ({ page, wallet }) => {
    await answerParameters(page)
    await page.goto(linkTo("tip"))

    await page.getByRole("button", { name: "Tip 5 ADA" }).click()
    await page.getByRole("button", { name: /Test Wallet/ }).click()
    await page.getByRole("button", { name: "Sign transaction" }).click()

    await expect(page.getByRole("heading", { name: "You declined in your wallet" })).toBeVisible()
    expect(await wallet.calls("submitTx")).toHaveLength(0)
  })
})

test.describe("a wallet on mainnet", () => {
  test.use({ walletOptions: { ...wallet, networkId: 1 } })

  test("is caught before the endpoint is asked to build anything", async ({ page, wallet }) => {
    await answerParameters(page)
    const builds: string[] = []
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().startsWith(examples)) builds.push(request.url())
    })
    await page.goto(linkTo("tip"))

    await page.getByRole("button", { name: "Tip 5 ADA" }).click()
    await page.getByRole("button", { name: /Test Wallet/ }).click()

    await expect(page.getByRole("heading", { name: "Your wallet is on mainnet" })).toBeVisible()
    expect(builds).toEqual([])
    expect(await wallet.calls("signTx")).toHaveLength(0)
  })
})

test.describe("the scripted wallet's preview", () => {
  test.use({ walletOptions: { ...wallet, install: false } })

  test("walks the served preview tip to a receipt", async ({ page }) => {
    await answerParameters(page)
    await page.goto(`/preview/flow?uri=${encodeURIComponent(`${examples}/tip`)}&wallet=signs`)

    await page.getByRole("button", { name: "Tip 5 ADA" }).click()
    await page.getByRole("button", { name: /Preview wallet/ }).click()
    await page.getByRole("button", { name: "Sign transaction" }).click()

    await expect(page.getByText("Sent to Preview")).toBeVisible()
  })

  test("shows a mainnet wallet the wrong-network screen", async ({ page }) => {
    await answerParameters(page)
    await page.goto(`/preview/flow?uri=${encodeURIComponent(`${examples}/tip`)}&wallet=signs&network=mainnet`)

    await page.getByRole("button", { name: "Tip 5 ADA" }).click()
    await page.getByRole("button", { name: /Preview wallet/ }).click()

    await expect(page.getByRole("heading", { name: "Your wallet is on mainnet" })).toBeVisible()
  })
})
