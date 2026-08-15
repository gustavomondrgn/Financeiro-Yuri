import { requireSession } from '@/lib/auth'
import { countPendingReview } from '@/lib/analytics/queries'
import { Shell } from '@/components/shell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession()
  const pendingReview = await countPendingReview()

  return (
    <Shell user={{ name: user.name, email: user.email }} pendingReview={pendingReview}>
      {children}
    </Shell>
  )
}
