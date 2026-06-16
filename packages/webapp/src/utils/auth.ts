import cookies from 'js-cookie'
import store from 'store2'

import { helper, nanoid } from '@heyform-inc/utils'

import { COOKIE_OPTIONS, DEVICEID_COOKIE_NAME, LOGGED_COOKIE_NAME } from '@/consts'

export function setCookie(key: string, value: string, options = COOKIE_OPTIONS) {
  cookies.set(key, value, options)
}

export function getCookie(key: string) {
  return cookies.get(key)
}

export function clearCookie(key: string) {
  cookies.remove(key, {
    domain: COOKIE_OPTIONS.domain,
    path: '/',
    sameSite: COOKIE_OPTIONS.sameSite,
    secure: COOKIE_OPTIONS.secure
  })

  cookies.remove(key, {
    path: '/',
    sameSite: COOKIE_OPTIONS.sameSite,
    secure: COOKIE_OPTIONS.secure
  })
}

export function getAuthState() {
  const value = getCookie(LOGGED_COOKIE_NAME)
  return helper.isTrue(value)
}

export function clearAuthState() {
  Object.keys(localStorage).forEach(key => {
    if (key !== DEVICEID_COOKIE_NAME) {
      store.remove(key)
    }
  })

  clearCookie(LOGGED_COOKIE_NAME)
}

export function getDeviceId() {
  const storage = store.get(DEVICEID_COOKIE_NAME)
  const cookie = getCookie(DEVICEID_COOKIE_NAME)

  // SupportHub SSO trust order: the server-set HEYFORM_DEVICE_ID cookie is authoritative.
  // On an SSO landing the /sso endpoint pins the heyform session to the cookie's deviceId,
  // so a stale localStorage id from a prior session must NOT overwrite it (doing so makes
  // every guarded GraphQL call 403 via AuthGuard's x-device-id check). Therefore: when a
  // cookie is present, sync localStorage to it; only fall back to localStorage when no cookie.
  if (helper.isValid(cookie)) {
    if (!helper.isEqual(storage, cookie)) {
      store.set(DEVICEID_COOKIE_NAME, cookie)
    }

    return cookie
  } else if (helper.isValid(storage)) {
    setCookie(DEVICEID_COOKIE_NAME, storage)
    return storage
  }
}

export function setDeviceId() {
  const deviceId = nanoid(12)

  setCookie(DEVICEID_COOKIE_NAME, deviceId)
  store.set(DEVICEID_COOKIE_NAME, deviceId)
}
