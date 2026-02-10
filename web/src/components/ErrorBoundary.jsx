import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        this.setState({ error, errorInfo });
        console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div style={styles.body}>
                    <div style={styles.bgGrid}></div>
                    <div style={styles.scanline}></div>

                    <div style={styles.container}>
                        <div style={styles.lockIcon}>
                            <div style={styles.lockShackle}></div>
                            <div style={styles.lockBody}></div>
                        </div>

                        <div style={styles.errorCode}>ERRO</div>

                        <h1 style={styles.title}>Algo Correu Mal</h1>

                        <p style={styles.message}>
                            O cofre encontrou um problema inesperado.
                            Os teus dados estão seguros, mas precisamos de reiniciar.
                        </p>

                        <div style={styles.terminal}>
                            <div style={styles.terminalHeader}>
                                <div style={{ ...styles.dot, background: '#ff5f56' }}></div>
                                <div style={{ ...styles.dot, background: '#ffbd2e' }}></div>
                                <div style={{ ...styles.dot, background: '#27c93f' }}></div>
                            </div>
                            <div style={styles.terminalContent}>
                                <div>$ richiesafe --diagnose</div>
                                <div style={{ color: '#ff5f56' }}>[ERRO] {this.state.error?.message || 'Erro desconhecido'}</div>
                                <div style={{ color: '#ffbd2e' }}>[INFO] Timestamp: {new Date().toLocaleString('pt-PT')}</div>
                                <div>$ _<span style={styles.cursor}></span></div>
                            </div>
                        </div>

                        <div style={styles.actions}>
                            <button onClick={this.handleRetry} style={styles.btnPrimary}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="23 4 23 10 17 10"></polyline>
                                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                                </svg>
                                Reiniciar App
                            </button>
                            <button onClick={() => window.location.href = '/'} style={styles.btn}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                                    <polyline points="9 22 9 12 15 12 15 22"></polyline>
                                </svg>
                                Voltar ao Início
                            </button>
                        </div>

                        <div style={styles.footer}>
                            RichieSafe <span style={{ color: '#00ff88' }}>●</span> Segurança de Nível Militar
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

const styles = {
    body: {
        fontFamily: "'Space Grotesk', 'Inter', sans-serif",
        background: '#0a0a0f',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        position: 'relative',
    },
    bgGrid: {
        position: 'absolute',
        width: '200%',
        height: '200%',
        backgroundImage: `
      linear-gradient(rgba(0, 255, 136, 0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0, 255, 136, 0.03) 1px, transparent 1px)
    `,
        backgroundSize: '50px 50px',
        transform: 'perspective(500px) rotateX(60deg)',
        top: '-50%',
    },
    scanline: {
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: `linear-gradient(
      to bottom,
      transparent 50%,
      rgba(0, 255, 136, 0.02) 50%
    )`,
        backgroundSize: '100% 4px',
        pointerEvents: 'none',
        zIndex: 100,
    },
    container: {
        position: 'relative',
        zIndex: 10,
        textAlign: 'center',
        padding: '3rem',
        maxWidth: '600px',
    },
    lockIcon: {
        width: '120px',
        height: '120px',
        margin: '0 auto 2rem',
        position: 'relative',
    },
    lockBody: {
        width: '80px',
        height: '60px',
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        border: '3px solid #00ff88',
        borderRadius: '10px',
        position: 'absolute',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        boxShadow: '0 0 30px rgba(0, 255, 136, 0.3)',
    },
    lockShackle: {
        width: '50px',
        height: '50px',
        border: '3px solid #00ff88',
        borderBottom: 'none',
        borderRadius: '25px 25px 0 0',
        position: 'absolute',
        top: '10px',
        left: '50%',
        transform: 'translateX(-30%) rotate(-20deg)',
    },
    errorCode: {
        fontSize: '4rem',
        fontWeight: 700,
        color: 'transparent',
        WebkitTextStroke: '2px #ff5f56',
        textShadow: '0 0 30px rgba(255, 95, 86, 0.5)',
        marginBottom: '1rem',
    },
    title: {
        fontSize: '2rem',
        color: '#fff',
        marginBottom: '1rem',
        fontWeight: 600,
    },
    message: {
        color: '#888',
        fontSize: '1.1rem',
        lineHeight: 1.6,
        marginBottom: '2rem',
        maxWidth: '400px',
        marginLeft: 'auto',
        marginRight: 'auto',
    },
    terminal: {
        background: '#0d0d12',
        border: '1px solid #333',
        borderRadius: '8px',
        padding: '1.5rem',
        margin: '2rem 0',
        fontFamily: "'Courier New', monospace",
        textAlign: 'left',
        position: 'relative',
        overflow: 'hidden',
    },
    terminalHeader: {
        display: 'flex',
        gap: '6px',
        marginBottom: '1rem',
    },
    dot: {
        width: '12px',
        height: '12px',
        borderRadius: '50%',
    },
    terminalContent: {
        color: '#00ff88',
        fontSize: '0.9rem',
        lineHeight: 1.8,
    },
    cursor: {
        display: 'inline-block',
        width: '8px',
        height: '16px',
        background: '#00ff88',
        verticalAlign: 'middle',
        animation: 'blink 1s infinite',
    },
    actions: {
        display: 'flex',
        gap: '1rem',
        justifyContent: 'center',
        flexWrap: 'wrap',
    },
    btn: {
        padding: '1rem 2rem',
        border: '2px solid #00ff88',
        background: 'transparent',
        color: '#00ff88',
        fontFamily: "'Space Grotesk', 'Inter', sans-serif",
        fontSize: '1rem',
        fontWeight: 600,
        borderRadius: '8px',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        textDecoration: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
    },
    btnPrimary: {
        padding: '1rem 2rem',
        border: '2px solid #00ff88',
        background: '#00ff88',
        color: '#0a0a0f',
        fontFamily: "'Space Grotesk', 'Inter', sans-serif",
        fontSize: '1rem',
        fontWeight: 600,
        borderRadius: '8px',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        textDecoration: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
    },
    footer: {
        marginTop: '3rem',
        color: '#555',
        fontSize: '0.9rem',
    },
};

export default ErrorBoundary;
