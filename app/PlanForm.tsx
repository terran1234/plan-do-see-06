import type { Plan } from '@/lib/db'

export default function PlanForm({
  action,
  plan,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>
  plan?: Plan
  submitLabel: string
}) {
  return (
    <form action={action} className="form">
      {plan && <input type="hidden" name="id" value={plan.id} />}
      <label>
        계획 이름
        <input name="title" required maxLength={100} defaultValue={plan?.title} placeholder="예) 정보처리기사 실기 시험 준비" />
      </label>
      <div className="row">
        <label>
          시작일
          <input type="date" name="start_date" required defaultValue={plan?.start_date} />
        </label>
        <label>
          종료일
          <input type="date" name="end_date" required defaultValue={plan?.end_date} />
        </label>
      </div>
      <div className="row">
        <label>
          우선순위
          <select name="priority" defaultValue={plan?.priority ?? '보통'}>
            <option>높음</option>
            <option>보통</option>
            <option>낮음</option>
          </select>
        </label>
      </div>
      <label>
        성공 기준
        <textarea name="success_criteria" required maxLength={500} rows={3} defaultValue={plan?.success_criteria} />
      </label>
      <button type="submit">{submitLabel}</button>
    </form>
  )
}
