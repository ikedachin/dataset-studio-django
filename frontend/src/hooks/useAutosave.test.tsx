import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAutosave } from './useAutosave'

describe('useAutosave', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
  it('debounces updates and sends the expected version', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: { id:1, splitId:1, position:1, status:'edited', preview:'x', validationErrors:0, validationWarnings:0, original:{a:'x'}, data:{a:'y'}, isNew:false, isDeleted:false, version:3, updatedAt:'' } }), { status:200, headers:{'Content-Type':'application/json'} }))
    const onSaved = vi.fn()
    const record = { id:1, splitId:1, position:1, status:'unedited', preview:'x', validationErrors:0, validationWarnings:0, original:{a:'x'}, data:{a:'x'}, isNew:false, isDeleted:false, version:2, updatedAt:'' }
    const { result } = renderHook(() => useAutosave(record, { a:'y' }, onSaved))
    act(() => result.current.markDirty())
    expect(result.current.state).toBe('unsaved')
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('"version":2')
    expect(onSaved).toHaveBeenCalledOnce()
  })
  it('uses updated record version after external save', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: { id:1, splitId:1, position:1, status:'edited', preview:'x', validationErrors:0, validationWarnings:0, original:{a:'x'}, data:{a:'z'}, isNew:false, isDeleted:false, version:4, updatedAt:'' } }), { status:200, headers:{'Content-Type':'application/json'} }))
    const onSaved = vi.fn()
    const initial = { id:1, splitId:1, position:1, status:'unedited', preview:'x', validationErrors:0, validationWarnings:0, original:{a:'x'}, data:{a:'x'}, isNew:false, isDeleted:false, version:2, updatedAt:'' }
    const updated = { ...initial, data: { a:'y' }, version:3 }
    const { result, rerender } = renderHook(
      ({ record, data }) => useAutosave(record, data, onSaved),
      { initialProps: { record: initial, data: { a:'x' } } },
    )
    rerender({ record: updated, data: { a:'z' } })
    act(() => result.current.markDirty())
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('"version":3')
  })
})
