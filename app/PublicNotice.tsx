// 이 화면이 로그인한 사람에게만 열린다는 사실을 화면 맨 위에 밝힌다.
export default function PublicNotice() {
  return (
    <p className="notice" role="note">
      🔒 로그인한 사람만 들어올 수 있는 화면입니다.
    </p>
  )
}
