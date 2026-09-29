import { SlipPage } from "../slip-page/slip-page.js"

export type PageProps = {
  readonly searchParams: Promise<Record<string, string | ReadonlyArray<string> | undefined>>
}

/** The link arrives as `?uri=`, the name the spec's `//slip` authority gives it. */
export default async function Page({ searchParams }: PageProps) {
  const { uri } = await searchParams
  return <SlipPage link={typeof uri === "string" ? uri : undefined} />
}
