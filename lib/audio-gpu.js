/** One local GPU audio job at a time; text chat remains independent. */
let tail = Promise.resolve()
export function withAudioGpu(work) {
  const next = tail.then(work)
  tail = next.catch(() => {})
  return next
}
