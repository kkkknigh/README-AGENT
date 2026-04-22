export interface PasswordCheck {
  valid: boolean
  strength: 'weak' | 'medium' | 'strong'
  errors: string[]
}

export function validatePassword(password: string): PasswordCheck {
  const errors: string[] = []

  if (password.length < 8) {
    errors.push('密码至少 8 个字符')
  }
  if (!/[a-zA-Z]/.test(password)) {
    errors.push('密码需要包含字母')
  }
  if (!/\d/.test(password)) {
    errors.push('密码需要包含数字')
  }

  if (errors.length > 0) {
    return { valid: false, strength: 'weak', errors }
  }

  // 计算强度
  let score = 0
  if (password.length >= 12) score++
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++
  if (/[^a-zA-Z0-9]/.test(password)) score++

  const strength = score >= 2 ? 'strong' : 'medium'
  return { valid: true, strength, errors: [] }
}

export const strengthLabel: Record<string, string> = {
  weak: '弱',
  medium: '中',
  strong: '强',
}

export const strengthColor: Record<string, string> = {
  weak: 'bg-red-500',
  medium: 'bg-yellow-500',
  strong: 'bg-green-500',
}

export const strengthTextColor: Record<string, string> = {
  weak: 'text-red-500',
  medium: 'text-yellow-500',
  strong: 'text-green-500',
}
