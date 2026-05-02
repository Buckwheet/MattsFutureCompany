import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { Package, Scan, Plus, Search, AlertTriangle, ArrowLeft, Save } from 'lucide-react';
import './App.css';

const API_BASE = 'https://peterson-backend.buckwheet.workers.dev';

function App() {
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showScanner, setShowScanner] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '', sku: '', upc: '', price: '', quantity: 1, reorder_point: 2, description: ''
  });

  useEffect(() => {
    fetchParts();
  }, []);

  const fetchParts = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/parts`);
      setParts(res.data);
      setLoading(false);
    } catch (e) {
      console.error('Fetch error:', e);
      setLoading(false);
    }
  };

  const startScanner = () => {
    setShowScanner(true);
    setTimeout(() => {
      const scanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 });
      scanner.render((decodedText) => {
        setFormData({ ...formData, upc: decodedText, sku: decodedText });
        scanner.clear();
        setShowScanner(false);
        setShowAddModal(true);
      }, (error) => {
        // console.warn(error);
      });
    }, 100);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/api/parts`, {
        ...formData,
        price: parseFloat(formData.price),
        quantity: parseInt(formData.quantity),
        reorder_point: parseInt(formData.reorder_point)
      });
      setShowAddModal(false);
      fetchParts();
      setFormData({ name: '', sku: '', upc: '', price: '', quantity: 1, reorder_point: 2, description: '' });
    } catch (e) {
      alert('Error saving part: ' + e.message);
    }
  };

  return (
    <div className="app-container">
      <header>
        <div>
          <h1>Parts Manager</h1>
          <span className="badge">LIVE SYNC</span>
        </div>
        <Package color="white" size={24} />
      </header>

      {/* Stats Summary */}
      <div className="card" style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
        <div>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.8rem' }}>Items</p>
          <p style={{ margin: '5px 0 0', fontWeight: 'bold' }}>{parts.length}</p>
        </div>
        <div style={{ borderLeft: '1px solid #333', borderRight: '1px solid #333', padding: '0 20px' }}>
          <p style={{ margin: 0, color: 'var(--accent)', fontSize: '0.8rem' }}>Low Stock</p>
          <p style={{ margin: '5px 0 0', fontWeight: 'bold' }}>
            {parts.filter(p => p.quantity <= p.reorder_point).length}
          </p>
        </div>
        <div>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.8rem' }}>Value</p>
          <p style={{ margin: '5px 0 0', fontWeight: 'bold' }}>
            ${parts.reduce((sum, p) => sum + (p.price * p.quantity), 0).toFixed(0)}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '30px' }}>
        <button className="btn btn-primary" onClick={startScanner}>
          <Scan size={20} /> Scan UPC
        </button>
        <button className="btn btn-secondary" onClick={() => setShowAddModal(true)}>
          <Plus size={20} /> Add Part
        </button>
      </div>

      {/* Inventory List */}
      <div className="part-list">
        <h2>Inventory</h2>
        {loading ? (
          <p>Loading...</p>
        ) : parts.length === 0 ? (
          <p style={{ color: 'var(--muted)', textAlign: 'center' }}>No parts in inventory yet.</p>
        ) : (
          parts.map(part => (
            <div key={part.id} className="part-item">
              <div className="part-info">
                <h3>{part.name}</h3>
                <p>SKU: {part.sku}</p>
              </div>
              <div className="part-stock">
                <span className={`stock-num ${part.quantity <= part.reorder_point ? 'stock-low' : ''}`}>
                  {part.quantity}
                </span>
                <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--muted)' }}>in stock</p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Scanner Overlay */}
      {showScanner && (
        <div className="scanner-container">
          <div className="scanner-overlay">
            <button className="btn btn-secondary" onClick={() => setShowScanner(false)} style={{ width: 'auto', marginBottom: '10px' }}>
              <ArrowLeft size={18} /> Cancel
            </button>
            <p>Point camera at the barcode</p>
          </div>
          <div id="reader"></div>
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>Add New Part</h2>
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>Part Name</label>
                <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. Spark Plug RJ19LM" />
              </div>
              <div className="form-group">
                <label>SKU / UPC</label>
                <input required value={formData.sku} onChange={e => setFormData({...formData, sku: e.target.value})} placeholder="Scan or type..." />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-group">
                  <label>Price ($)</label>
                  <input type="number" step="0.01" required value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Qty</label>
                  <input type="number" required value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '20px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary"><Save size={18} /> Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
