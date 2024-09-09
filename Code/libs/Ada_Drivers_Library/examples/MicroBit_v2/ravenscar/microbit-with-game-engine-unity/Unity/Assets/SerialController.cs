using System;
using System.Collections.Concurrent;
using System.Threading;
using System.IO.Ports;

public class SerialController
{
    private static SerialPort stream;
    public static volatile bool isActive = true;
    public static ConcurrentQueue<string> TX = new ConcurrentQueue<string>();
    public static ConcurrentQueue<string> RX = new ConcurrentQueue<string>();
    public static Thread serialThread;

    public static void Init()
    {
        serialThread = new Thread(() =>
        {
            Thread.CurrentThread.IsBackground = true;
            try
            {
                stream = new SerialPort("COM4", 115200, Parity.None, 8, StopBits.One);
                stream.Open();
                string message;
                string response;

                while (isActive) //this implementation assumes that queue consumption is faster than queue production. It will produce delays and a bufferoverflow if this is not the case!
                {
                    //SEND
                    try
                    {
                        //TX.TryDequeue(out message);

                        ////send
                        //if (message != null)
                        //    Send(message);
                    }
                    catch { }

                    ////RECEIVE
                    try
                    {
                        response = stream.ReadLine();

                        if (response.Length > 0)
                        {

                            RX.Enqueue(response);
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine("[Exception] RX: {0}", ex);
                    }
                }
            }
            catch (Exception ex) {
                Console.WriteLine("[Exception] No serial connection: {0}", ex);
            }
        });

        serialThread.Start();
    }
    
    public static void Send(string message)
    {
        try
        {
            stream.Write(message);
        }
        catch (Exception ex) //catch if eg. port is closed 
        {
            Console.WriteLine("[Exception] SerialController.Send: {0}", ex);
        }
    }

    public static void Close()
    {
        isActive = false;
        stream.Close();
        serialThread.Join();
        
    }
}