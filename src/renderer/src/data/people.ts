export type Person = {
  name: string
  initials: string
  color: string
  status: string
}

export const people: Person[] = [
  { name: 'Maya', initials: 'MK', color: 'bg-[#dbe9ff]', status: 'focused' },
  { name: 'Jake', initials: 'JW', color: 'bg-[#f4ddff]', status: 'focused' },
  { name: 'Priya', initials: 'PS', color: 'bg-[#ffdfd5]', status: 'drifting' },
]
