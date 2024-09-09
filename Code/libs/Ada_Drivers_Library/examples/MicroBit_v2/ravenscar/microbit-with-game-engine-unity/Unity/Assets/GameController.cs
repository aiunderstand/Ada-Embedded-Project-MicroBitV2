using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System;
using TMPro;
using System.Text;
using static USN.Instruction;

namespace USN
{
    public class GameController : MonoBehaviour
    {
        public float sensitivityAccX = 1; //0.36
        public float sensitivityAccY = 1; //0.36
        public float sensitivityAccZ = 1; //0.36
        public float sensitivityMagX = 1; //0.36
        public float sensitivityMagY = 1; //0.36
        public float sensitivityMagZ = 1; //0.36
        public Led[] Leds;
        public CustomButton[] Btns;
        public bool useAccelerometer = false;
        public bool useMagnetometer = false;
        public bool useLeds = true;
        public bool useButtons = true;
        public bool useWorldBackground = false;
        public bool withUIpanel = true;

        //stats
        public int btnAcount = 0;
        public int btnBcount = 0;
        public int btnLcount = 0;

        //ui
        public TMP_Text btnAcountLabel;
        public TMP_Text btnBcountLabel;
        public TMP_Text btnLcountLabel;

        public TMP_Text accelXLabel;
        public TMP_Text accelYLabel;
        public TMP_Text accelZLabel;

        public TMP_Text magnetoXLabel;
        public TMP_Text magnetoYLabel;
        public TMP_Text magnetoZLabel;

        float AccelX;
        float AccelY;
        float AccelZ;
        bool DownAOnce = true;
        bool UpAOnce = false;
        bool DownBOnce = true;
        bool UpBOnce = false;
        bool DownLOnce = true;
        bool UpLOnce = false;

        public States State;
       

        void Start()
        {
            SerialController.Init();
        }

        private void LateUpdate()
        {
            Receive();
            UpdateState();
            if (useWorldBackground)
                Camera.main.clearFlags = CameraClearFlags.Skybox;
            else
                Camera.main.clearFlags = CameraClearFlags.SolidColor;
        }

        private void UpdateState()
        {
            State = new States(Btns[0].isPressed, 
                               Btns[0].isDown,
                               Btns[0].isUp,
                               Btns[1].isPressed,
                               Btns[1].isDown,
                               Btns[1].isUp,
                               AccelX,
                               AccelY,
                               AccelZ);
        }

        void Receive()
        {
            var messageCount = SerialController.RX.Count;
            for (int i = 0; i < messageCount; i++)
            {
                string message;
                SerialController.RX.TryDequeue(out message);


                //Syntax:  "instruction;param1,value;param2,value;---;paramN,value"
                //Example: "leds;led1_1, off;led5_5,on"
                //This instruction is related to leds, stating to switch off led 1_1 (top left corner) and switch on led5_5 (bottom right corner).

                //Syntax Benefit: it is readable over the serial port and can deal with all messages from 1 bit IO's to accelerometers floats and debug strings
                //Syntax Drawback: Cumbersome to implement at the ADA side and very communication heavy.
                //Improved Syntax: Only send a package of 20 bytes +1 byte end of line, meaning that every byte is a MB_pin being high or low
                //Then the syntax is not as readible over the serial port but still somewhat readable AND the message can then be parsed at C# side where there
                //is a lot of compute power. It is easily expendable if you want to send all 47 pins.
                //It is easily implementable at the ADA side using a With Microbit.Simulation package in your main.adb file using a task with highest priority.
                //At at signal rate of 115.000 Baud, with binary signals one Baud is one bit per second, so in our case the bit rate is 115.000 bps
                //in Bytes per second this is 115.000 / 8 = 14.375 Bytes per second.
                //Since we have 21 bytes, we can update at the ADA side with a max rate (frequency) of: 684 times per second.
                //This results in a "delay until" in the Microbit.Simulation of about 1.46 miliseconds. This is fast enough for most real-time applications.  

                //Note that this compressed format does not address multibit packages. For example an accelerometer will need to send a float
                //We could signal that the 21 byte package is actually larger as it also includes a few floats from which we know the size.
                //If the MBpin of the accelerometer is 1, then we expect an X number of extra bits immediately following that 1. Note that this is careful package engineering!
                //We could do the same for a debug message as a string by a convention that the last bit (in this case we would need 22 bits + 1 bit for end of line)
                //is always reserved for debug message. If this is 1 then a --variable amount!-- of bits follow with the second last bit being the end of the string
                //and the last bit being the end of line. 

                List<Instruction> instructions = parseInstructionsFromMessage(message);
            
                foreach (Instruction instruction in instructions)
                {
                    switch (instruction.Name)
                    {
                        case Instruction.InstructionSet.BTN:
                            {
                                if (useButtons)
                                {
                                    foreach (var btn in instruction.Params)
                                    {
                                        switch (btn.Name)
                                        {
                                            case "A":
                                                {
                                                    if ((btn.Value.Equals("True")) || (btn.Value.Equals("1")))
                                                    {
                                                        Btns[0].Press(true);
                                                        
                                                        if (Btns[0].isDown == false && DownAOnce)
                                                        {
                                                            Btns[0].isDown = true;
                                                            Btns[0].isUp = false;
                                                            UpAOnce = true;
                                                            DownAOnce = false;
                                                            btnAcount++;
                                                        }
                                                        else
                                                            Btns[0].isDown = false;
                                                       
                                                        if (withUIpanel)
                                                            btnAcountLabel.text = btnAcount.ToString();
                                                    }
                                                    else
                                                    {
                                                        Btns[0].Press(false);
                                                        
                                                        if (Btns[0].isUp == false && UpAOnce)
                                                        {
                                                            Btns[0].isDown = false;
                                                            Btns[0].isUp = true;
                                                            UpAOnce = false;
                                                            DownAOnce = true;
                                                        }                                                           
                                                        else
                                                            Btns[0].isUp = false;
                                                    }
                                                }
                                                break;
                                            case "B":
                                                {
                                                    if ((btn.Value.Equals("True")) || (btn.Value.Equals("1")))
                                                    {
                                                        Btns[1].Press(true);

                                                        if (Btns[1].isDown == false && DownBOnce)
                                                        {
                                                            Btns[1].isDown = true;
                                                            Btns[1].isUp = false;
                                                            UpBOnce = true;
                                                            DownBOnce = false;
                                                            btnBcount++;                                                            
                                                        }
                                                        else
                                                            Btns[1].isDown = false;

                                                        if (withUIpanel)
                                                            btnBcountLabel.text = btnBcount.ToString();
                                                    }
                                                    else
                                                    {
                                                        Btns[1].Press(false);

                                                        if (Btns[1].isUp == false && UpBOnce)
                                                        {
                                                            Btns[1].isDown = false;
                                                            Btns[1].isUp = true;
                                                            UpBOnce = false;
                                                            DownBOnce = true;                                                          
                                                        }
                                                        else
                                                            Btns[1].isUp = false;
                                                    }
                                                }
                                                break;
                                            case "L":
                                                {
                                                    //not fully implemented, incorrect logo release detected while pressing logo!
                                                    if ((btn.Value.Equals("True")) || (btn.Value.Equals("1")))
                                                    {
                                                        Btns[2].Press(true);

                                                        if (Btns[2].isDown == false && DownLOnce)
                                                        {
                                                            Btns[2].isDown = true;
                                                            Btns[2].isUp = false;
                                                            UpLOnce = true;
                                                            DownLOnce = false;
                                                            btnLcount++;
                                                        }
                                                        else
                                                            Btns[2].isDown = false;

                                                        if (withUIpanel)
                                                            btnLcountLabel.text = btnLcount.ToString();
                                                    }
                                                    else
                                                    {
                                                        Btns[2].Press(false);

                                                        if (Btns[2].isUp == false && UpLOnce)
                                                        {
                                                            Btns[2].isDown = false;
                                                            Btns[2].isUp = true;
                                                            UpLOnce = false;
                                                            DownLOnce = true;
                                                        }
                                                        else
                                                            Btns[2].isUp = false;
                                                    }
                                                }
                                                break;
                                        }

                                    }
                                }
                            }
                            break;
                        case Instruction.InstructionSet.LED:
                            {
                                if (useLeds)
                                {
                                    foreach (var led in instruction.Params)
                                    {
                                        //use id of led and index of ledArray. So led 1 is R1_C1, led 2 is R2_C2, etc)
                                        int ledId = int.Parse(led.Name);
                                        bool ledStatus;
                                        if (led.Value.Contains("1") || led.Value.Contains("0"))
                                            ledStatus = Convert.ToBoolean(int.Parse(led.Value));
                                        else
                                            ledStatus = Convert.ToBoolean(led.Value);

                                        Leds[ledId].Switch(ledStatus);
                                    }
                                }
                            }
                            break;
                        case Instruction.InstructionSet.ACC:
                            {
                                if (useAccelerometer)
                                {
                                //this part can be improved such that we can also look at the back side of the MB and integrate a compass when implementaion is done
                                //sensitivity is not sensitivity but a correction/alignment factor since the conversion from MB to Unity is weird
                                //Since Accel raw memory data is 16 bits, but Accel power mode fill only 10 bits, so Axel_Data package is 10 bits with a correction. 
                                //https://www.st.com/resource/en/datasheet/lsm303agr.pdf
                                    AccelX =     float.Parse(instruction.Params[0].Value.Trim()) * sensitivityAccX;
                                    AccelY = -1* float.Parse(instruction.Params[1].Value.Trim()) * sensitivityAccY; //note the - sign!
                                    AccelZ =     float.Parse(instruction.Params[2].Value.Trim()) * sensitivityAccZ;

                                    if (withUIpanel)
                                    {
                                        accelXLabel.text = AccelX.ToString();
                                        accelYLabel.text = AccelY.ToString();
                                        accelZLabel.text = AccelZ.ToString();
                                    }

                                    ResetRotateObject(); //gimbal lock with current quaternion implemention hence need to reset.  
                                    RotateObject(AccelX, this.transform.rotation.eulerAngles.y, AccelY); //note that we currently dont use Z value!
                                }
                                else
                                {
                                    ResetRotateObject();
                                    RotateObject(0, this.transform.rotation.eulerAngles.y, 90);
                                }
                            }
                            break;
                        case Instruction.InstructionSet.MAG:
                            {
                                if (useMagnetometer)
                                {
                                    float x = float.Parse(instruction.Params[0].Value) * sensitivityMagX;
                                    float y = -float.Parse(instruction.Params[1].Value) * sensitivityMagY;
                                    float z = float.Parse(instruction.Params[2].Value) * sensitivityMagZ;

                                    magnetoXLabel.text = x.ToString(); //we dont use x coordinate. use Accel.
                                    magnetoYLabel.text = y.ToString(); //we dont use y coordinate. Use Accel. 
                                    magnetoZLabel.text = z.ToString();
                                    RotateObject(this.transform.rotation.eulerAngles.x, z, this.transform.rotation.eulerAngles.z);
                                }
                                else
                                    RotateObject(this.transform.rotation.eulerAngles.x, 0, this.transform.rotation.eulerAngles.z);
                            }
                            break;
                        case Instruction.InstructionSet.RST:
                            {
                                btnAcount = 0;
                                btnBcount = 0;
                                btnLcount = 0;

                                if (withUIpanel)
                                {
                                    btnAcountLabel.text = "0";
                                    btnBcountLabel.text = "0";
                                    btnLcountLabel.text = "0";
                                    accelXLabel.text = "0";
                                    accelYLabel.text = "0";
                                    accelZLabel.text = "0";
                                    magnetoXLabel.text = "0";
                                    magnetoYLabel.text = "0";
                                    magnetoZLabel.text = "0";
                                }

                                foreach (var led in Leds)
                                    led.Switch(false);

                                RotateObject(0, this.transform.rotation.eulerAngles.y, 90);
                            }
                            break;
                        default:
                            break;
                    }
                }
            }
        }


        private List<Instruction> parseInstructionsFromMessage(string message)
        {
            List<Instruction> result = new List<Instruction>();
            
            bool hasError = false; ;
            var parts = message.Split(';');
            InstructionSet instrName;
            
            var findNameSuccessful = Enum.TryParse<InstructionSet>(parts[0], out instrName);
            if (findNameSuccessful)
            {
                if (instrName.Equals(InstructionSet.MSG)) //custom multi message
                {
                    //This custom multi message contains
                    //ACC*3, LED*25, BTN*3

                    //ACC
                    var Params = new InstructionParams[3];
                    Instruction instr = new Instruction();
                    instr.Name = InstructionSet.ACC;
                    instr.Params = Params;

                    //note that the -1 term is copied from ADA Axel_Data convert method
                    Params[0] = new InstructionParams("X", (-1 * ConvertToAxel_DataTickImage(parts[1].Trim(), parts[2].Trim())).ToString());
                    Params[1] = new InstructionParams("Y", ConvertToAxel_DataTickImage(parts[3].Trim(), parts[4].Trim()).ToString());
                    Params[2] = new InstructionParams("Z", ConvertToAxel_DataTickImage(parts[5].Trim(), parts[6].Trim()).ToString());

                    //add to list
                    result.Add(instr);

                    //convert from string to bytes and mask position of a byte to get a bit in the next parts
                    byte[] bytes = new byte[6];
                    bytes[0] = GetByteFromString(parts[7].Trim());
                    bytes[1] = GetByteFromString(parts[8].Trim());
                    bytes[2] = GetByteFromString(parts[9].Trim());
                    bytes[3] = GetByteFromString(parts[10].Trim());
                    bytes[4] = GetByteFromString(parts[11].Trim());
                    bytes[5] = GetByteFromString(parts[12].Trim());


                    //LED
                    Params = new InstructionParams[25];
                    instr = new Instruction();
                    instr.Name = InstructionSet.LED;
                    instr.Params = Params;

                    //row1
                    Params[0] = new InstructionParams("0", GetBit(bytes[0], 4).ToString());
                    Params[1] = new InstructionParams("1", GetBit(bytes[0], 3).ToString());
                    Params[2] = new InstructionParams("2", GetBit(bytes[0], 2).ToString());
                    Params[3] = new InstructionParams("3", GetBit(bytes[0], 1).ToString());
                    Params[4] = new InstructionParams("4", GetBit(bytes[0], 0).ToString());

                    //row2
                    Params[5] = new InstructionParams("5", GetBit(bytes[1], 4).ToString());
                    Params[6] = new InstructionParams("6", GetBit(bytes[1], 3).ToString());
                    Params[7] = new InstructionParams("7", GetBit(bytes[1], 2).ToString());
                    Params[8] = new InstructionParams("8", GetBit(bytes[1], 1).ToString());
                    Params[9] = new InstructionParams("9", GetBit(bytes[1], 0).ToString());

                    //row3
                    Params[10] = new InstructionParams("10", GetBit(bytes[2], 4).ToString());
                    Params[11] = new InstructionParams("11", GetBit(bytes[2], 3).ToString());
                    Params[12] = new InstructionParams("12", GetBit(bytes[2], 2).ToString());
                    Params[13] = new InstructionParams("13", GetBit(bytes[2], 1).ToString());
                    Params[14] = new InstructionParams("14", GetBit(bytes[2], 0).ToString());

                    //row4
                    Params[15] = new InstructionParams("15", GetBit(bytes[3], 4).ToString());
                    Params[16] = new InstructionParams("16", GetBit(bytes[3], 3).ToString());
                    Params[17] = new InstructionParams("17", GetBit(bytes[3], 2).ToString());
                    Params[18] = new InstructionParams("18", GetBit(bytes[3], 1).ToString());
                    Params[19] = new InstructionParams("19", GetBit(bytes[3], 0).ToString());

                    //row5
                    Params[20] = new InstructionParams("20", GetBit(bytes[4], 4).ToString());
                    Params[21] = new InstructionParams("21", GetBit(bytes[4], 3).ToString());
                    Params[22] = new InstructionParams("22", GetBit(bytes[4], 2).ToString());
                    Params[23] = new InstructionParams("23", GetBit(bytes[4], 1).ToString());
                    Params[24] = new InstructionParams("24", GetBit(bytes[4], 0).ToString());

                    result.Add(instr);

                    //add to list
                    Params = new InstructionParams[3];
                    instr = new Instruction();
                    instr.Name = InstructionSet.BTN;
                    instr.Params = Params;

                    //BTN
                    Params[0] = new InstructionParams("A", GetBit(bytes[5], 0).ToString());
                    Params[1] = new InstructionParams("B", GetBit(bytes[5], 1).ToString());
                    Params[2] = new InstructionParams("L", GetBit(bytes[5], 2).ToString());

                    //add to list
                    result.Add(instr);
                }
                else //single instruction message
                {
                    var Params = new InstructionParams[parts.Length - 1];
                    Instruction instr = new Instruction();
                    instr.Name = instrName;
                    instr.Params = Params;

                    //fill parameters
                    for (int i = 1; i < parts.Length; i++)
                    {
                        var paramParts = parts[i].Split(',');
                        
                        //sanity check
                        if (paramParts.Length == 2)
                            Params[i - 1] = new InstructionParams(paramParts[0], paramParts[1]);
                        else
                        {
                            hasError = true;
                            break;
                        }
                    }

                    //add to list
                    result.Add(instr);
                }
            }
            else
            {
                hasError = true;
            }

            if (hasError)
            {
                if (message.Contains("\0"))
                    //ignore
                    {}
                else
                    Debug.Log("Warning: instruction: " + parts[0] + " had incorrect syntax and will fail silently. Message was:" + message);
                
                result.Clear();
            }
          
            return result;
        }

        private short ConvertToAxel_DataTickImage(string low, string high)
        {
            byte h = GetByteFromString(high);
            byte l = GetByteFromString(low);
            //byte h = 0b01111111;
            //byte l = 0b11000000;
            int w = (int)(h << 24);
            //string textw = ($"High bit: {Convert.ToString(w, toBase: 2)}");
            int x = (int)(l << 16);
            //string textx = ($"Low bit: {Convert.ToString(x, toBase: 2)}");
            int y = (int)(w | x);
            //string texty = ($"High Low OR: {Convert.ToString(y, toBase: 2)}");
            int z = (int)(y >> 22); //arithmethic shift since this is 2's complement, so if sign bit is 1  inserts 1
            //string textz = ($"Arc. shift: {Convert.ToString(z, toBase: 2)}");
                        return (short) z;
        }

        private void RotateObject(float x, float y, float z)
        {
            transform.rotation = Quaternion.Euler(x, y, z);
        }

        private void ResetRotateObject()
        {
            transform.rotation = Quaternion.identity;
        }

        private void OnApplicationQuit()
        {
            SerialController.Close();
        }

        private byte GetByteFromString(string v)
        {
            int temp = 0;
            char[] t = v.ToCharArray();
            Array.Reverse(t); //reverse endian
            for (int i = 0; i < t.Length; i++)
                temp += (t[i] - 48) * (int)Math.Pow(10, i); //convert string to positional number 

            return (byte)temp;
        }

        public bool GetBit(byte b, int bitNumber)
        {
            return (b & (1 << bitNumber)) != 0;
        }

        public byte GetBitAsByte(byte b, int bitNumber)
        {
            if (GetBit(b, bitNumber) == true)
                return 1;
            else
                return 0;
        }
    }

    public class Instruction
    {
        public enum InstructionSet
        {
            MSG, //custom multi message, see example
            LED,
            ACC,
            MAG,
            BTN, 
            RST, //currently used to reset all counts and to tell that controller resetted
            ERR //ERROR
        }

        public InstructionSet Name;
        public InstructionParams[] Params;
        public Instruction() {
        }
    }
    
    public struct InstructionParams
    {
        public string Name;
        public string Value;

        public InstructionParams(string name, string value)
        {
            Name = name;
            Value = value;
        }
    }

    public struct States
    {
        public bool BtnA;
        public bool BtnADown;
        public bool BtnAUp;
        public bool BtnB;
        public bool BtnBDown;
        public bool BtnBUp;
        public float AccelX;
        public float AccelY;
        public float AccelZ;

        public States(bool btnA, bool btnADown, bool btnAUp, bool btnB, bool btnBDown, bool btnBUp, float accelX, float accelY, float accelZ)
        {
            BtnA = btnA;
            BtnADown = btnADown;
            BtnAUp = btnAUp;
            BtnB = btnB;
            BtnBDown = btnBDown;
            BtnBUp = btnBUp;

            AccelX = accelX;
            AccelY = accelY;
            AccelZ = accelZ;
        }
    }
}
