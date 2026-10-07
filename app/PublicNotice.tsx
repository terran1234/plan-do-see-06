// 아직 잠기지 않았다는 사실을 모든 화면 맨 위에 같은 문장으로 밝힌다.
export default function PublicNotice() {
  return (
    <p className="notice" role="note">
      ⚠️ 지금은 로그인이 없어 링크를 아는 사람은 누구나 볼 수 있습니다. 남이 봐도 괜찮은 내용만 넣으세요.
    </p>
  )
}
