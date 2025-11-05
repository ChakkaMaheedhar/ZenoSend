import React, { useEffect, useState } from 'react'
import { getContacts } from '../api'

export default function ContactsTable({ onSelectionChange }: { onSelectionChange: (ids: number[]) => void }) {
  const [status, setStatus] = useState<string>('valid')
  const [rows, setRows] = useState<any[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const load = async () => {
    try {
      const data = await getContacts(status || undefined)
      setRows(Array.isArray(data) ? data : []); setSelected(new Set()); onSelectionChange([])
    } catch (e: any) {
      setRows([]); setSelected(new Set()); onSelectionChange([])
    }
  }
  useEffect(() => { load() }, [status])

  const toggle = (id: number) => {
    const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id)
    setSelected(s); onSelectionChange(Array.from(s))
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>Contacts</h3>
        <div className="row">
          <label>Status:&nbsp;</label>
          <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="valid">valid</option>
            <option value="new">new</option>
            <option value="unknown">unknown</option>
            <option value="risky">risky</option>
            <option value="invalid">invalid</option>
          </select>
          <button className="btn secondary" onClick={load}>Refresh</button>
        </div>
      </div>
      <table>
        <thead>
          <tr><th></th><th>Email</th><th>Status</th><th>Reason</th><th>Provider</th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
              <td>{r.email}</td>
              <td><span className={`tag ${r.status}`}>{r.status}</span></td>
              <td>{r.reason || ''}</td>
              <td>{r.provider || ''}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} style={{ color: '#8aa0b6' }}>No contacts</td></tr>}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 10, color: '#8aa0b6' }}>Selected: {selected.size}</div>
    </div>
  )
}
