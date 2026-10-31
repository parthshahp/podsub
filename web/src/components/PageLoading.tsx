/** Static placeholders reserve the incoming layout without looping motion. */
export default function PageLoading({ noun, className }: { noun: string; className: string }) {
  const player = noun === "episode";
  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-screen-pending=""
      aria-busy="true"
      className={player ? "player-viewport flex min-h-0 flex-col overflow-hidden" : className}
    >
      <p role="status" className="sr-only">
        Loading {noun}…
      </p>
      {player ? (
        <div aria-hidden="true" className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <div className="flex shrink-0 items-center gap-3 border-b border-base-300 px-3 py-2 md:w-1/5 md:flex-col md:items-stretch md:border-r md:border-b-0 md:p-6">
              <Block className="h-12 w-12 shrink-0 md:aspect-square md:h-auto md:w-full" />
              <div className="flex-1 space-y-2">
                <Block className="h-4 w-4/5" />
                <Block className="h-3 w-1/2" />
              </div>
            </div>
            <div className="flex-1 space-y-10 overflow-hidden p-6">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="space-y-4">
                  <Block className="h-5 w-11/12" />
                  <Block className="h-5 w-3/4" />
                </div>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-center border-t border-base-300 bg-base-100 px-4 pb-1 sm:flex-row sm:gap-3 sm:px-6 sm:py-3">
            <div className="flex min-h-11 w-full items-center sm:order-2 sm:flex-1">
              <Block className="h-2 w-full" />
            </div>
            <Block round className="h-14 w-14 sm:h-11 sm:w-11" />
          </div>
        </div>
      ) : (
        <div
          aria-hidden="true"
          className={noun === "podcasts" ? "mx-auto max-w-5xl px-6 py-8" : ""}
        >
          {noun === "podcasts" ? (
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <Block className="h-8 w-40" />
                <Block className="mt-1 h-5 w-16" />
              </div>
              <Block className="h-11 w-full max-w-md sm:w-80" />
            </div>
          ) : noun === "podcast" ? (
            <>
              <div className="mb-2 h-11" />
              <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
                <Block className="h-28 w-28 shrink-0 sm:h-48 sm:w-48" />
                <div className="w-full space-y-4 pt-1">
                  <Block className="h-8 w-3/4" />
                  <Block className="h-4 w-1/2" />
                  <Block className="mt-4 h-12 w-full" />
                </div>
              </div>
            </>
          ) : (
            <Block className="h-8 w-40" />
          )}
          <Block className={noun === "podcasts" ? "h-10 w-full" : "mt-10 h-11 w-full"} />
          {noun === "podcasts" ? (
            <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-6 gap-y-8">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="space-y-3">
                  <Block className="aspect-square w-full" />
                  <Block className="h-4 w-4/5" />
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 divide-y divide-base-300">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="space-y-3 py-5">
                  <Block className="h-5 w-4/5" />
                  <Block className="h-3 w-1/2" />
                  <Block className="h-11 w-24 sm:hidden" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function Block({ className, round = false }: { className: string; round?: boolean }) {
  return <div className={`${round ? "rounded-full" : "rounded-md"} bg-base-300/60 ${className}`} />;
}
