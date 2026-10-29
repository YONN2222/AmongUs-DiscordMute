const formatter = new Intl.NumberFormat('en-US')

export function formatCount(n: number): string {
  return formatter.format(n)
}
