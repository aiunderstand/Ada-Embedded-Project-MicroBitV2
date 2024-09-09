------------------------------------------------------------------------------
--                                                                          --
--                    Copyright (C) 2016-2020, AdaCore                      --
--                                                                          --
--  Redistribution and use in source and binary forms, with or without      --
--  modification, are permitted provided that the following conditions are  --
--  met:                                                                    --
--     1. Redistributions of source code must retain the above copyright    --
--        notice, this list of conditions and the following disclaimer.     --
--     2. Redistributions in binary form must reproduce the above copyright --
--        notice, this list of conditions and the following disclaimer in   --
--        the documentation and/or other materials provided with the        --
--        distribution.                                                     --
--     3. Neither the name of the copyright holder nor the names of its     --
--        contributors may be used to endorse or promote products derived   --
--        from this software without specific prior written permission.     --
--                                                                          --
--   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS    --
--   "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT      --
--   LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR  --
--   A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT   --
--   HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, --
--   SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT       --
--   LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,  --
--   DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY  --
--   THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT    --
--   (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE  --
--   OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.   --
--                                                                          --
------------------------------------------------------------------------------

with HAL; use HAL;

package nRF.Radio is

   procedure Setup_For_Bluetooth_Low_Energy;
   --  Configure the radio for Bluetooth Low Energy (BLE) operations
   --  This procedure doesn't set:
   --    - Power
   --    - Frequency
   --    - Shortcuts
   --    - Adresses

   --  nRF radio packet format:
   --
   --  ---------------------------------------------------------------
   --  | PREAMBLE | BASE | PREFIX | S0 | LENGTH | S1 | PAYLOAD | CRC |
   --  ---------------------------------------------------------------
   --             |    ADDRESS    |      Stored in memory      |
   --

   type Radio_State is (Disabled,
                        Rx_Ramp_Up,
                        Rx_Idle,
                        Rx_State,
                        Rx_Disabled,
                        Tx_Ramp_Up,
                        Tx_Idle,
                        Tx_State,
                        Tx_Disabled);

   type Shortcut is (Ready_To_Start,
                     End_To_Disable,
                     Disabled_To_TXen,
                     Disabled_To_RXen,
                     Address_To_RSSIstart,
                     End_To_Start,
                     Address_To_BCstart);
   --  Setup shortcuts for the radio device. Shortcuts will start a task when
   --  the associated event is triggered.

   subtype Packet_Len is UInt8;

   type Radio_Frequency_MHz is range 2400 .. 2527;

   subtype Radio_Group is UInt8;

   type Radio_Power is (Zero_Dbm,
                        Pos_4_Dbm,
                        Pos_8_Dbm,
                        Neg_30_Dbm,
                        Neg_20_Dbm,
                        Neg_16_Dbm,
                        Neg_12_Dbm,
                        Neg_8_Dbm,
                        Neg_4_Dbm);

   type Radio_Mode is (Nordic_1MBIT,
                       Nordic_2MBIT,
                       Nordic_250KBIT,
                       BLE_1MBIT);

   function State return Radio_State;
   --  Return the current state of the radio

   procedure Enable_Shortcut (Short : Shortcut);
   --  Enable event to task shortcut

   procedure Disable_Shortcut (Short : Shortcut);
   --  Disable event to task shortcut

   procedure Set_Packet (PacketAddress : System.Address);
   --  Set packet address for RX or TX

   procedure Set_Frequency (F : Radio_Frequency_MHz);
   --  Set radio channel frequency

   procedure Set_Power (P : Radio_Power);
   --  Set radio output power

   procedure Set_Mode (Mode : Radio_Mode);
   --  Set radio protocol mode

   procedure Set_Logic_Addresses
     (Base0, Base1        : UInt32;
      Base_Length_In_Byte : UInt3;
      AP0, AP1, AP2, AP3, AP4, AP5, AP6, AP7 : UInt8);
   --  Define base a prefix addresses

   type Radio_Logic_Address is new UInt3;
   type Logic_Address_Mask is array (Radio_Logic_Address) of Boolean with Pack;

   procedure Translate_Logic_Address (Logic_Addr : Radio_Logic_Address;
                                      Base       : out UInt32;
                                      Prefix     : out UInt8);
   --  Return the base a prefix coresponding the given logic address

   procedure Set_TX_Address (Logic_Addr : Radio_Logic_Address);
   --  Select on of the logic address composed with Base[0-1] and AP[0-7]
   --  Logic Address | Base  | Prefix Address
   --  0             | Base0 | AP0
   --  1             | Base1 | AP1
   --  2             | Base1 | AP2
   --  3             | Base1 | AP3
   --  4             | Base1 | AP4
   --  5             | Base1 | AP5
   --  6             | Base1 | AP6
   --  7             | Base1 | AP7

   function RX_Match_Address return Radio_Logic_Address;
   --  Return the logic address on which previous packet was received.
   --  (see Set_TX_Address() for definition of logic adresses)

   procedure Set_RX_Addresses (Enable_Mask : Logic_Address_Mask);
   --  Mask logical adresses that will be used for RX

   procedure Configure_CRC (Enable        : Boolean;
                            Length        : UInt2;
                            Skip_Address  : Boolean;
                            Polynomial    : UInt32;
                            Initial_Value : UInt32)
     with Pre => (if Enable then Length /= 0);

   function CRC_Error return Boolean;
   --  Return True if the last packet was recieved with a CRC error

   procedure Configure_Whitening (Enable        : Boolean;
                                  Initial_Value : UInt6 := 0);

   type Length_Field_Endianness is (Little_Endian, Big_Endian);

   type Length_Field_S0 is (LengthZero, LengthIsOne);

   procedure Configure_Packet
     (S0_Field_Size_In_Byte        : Length_Field_S0;
      S1_Field_Size_In_Bit         : UInt4;
      Length_Field_Size_In_Bit     : UInt4;
      Max_Packet_Length_In_Byte    : Packet_Len;
      Static_Packet_Length_In_Byte : Packet_Len;
      On_Air_Endianness            : Length_Field_Endianness);


   ------------ SECTION RF SPECIFIC -----------
   MICROBIT_RADIO_MAXIMUM_RX_BUFFERS : constant Uint8 := 4;
   MICROBIT_RADIO_MAX_PACKET_SIZE : constant UInt8 := 32;
   MICROBIT_RADIO_HEADER_SIZE : constant Uint8 := 4;

   type Payload_Data is array (1 .. MICROBIT_RADIO_MAX_PACKET_SIZE)
     of UInt8 with Volatile;

   type Framebuffer is record
      Length        : UInt8 := 0; -- The length of the valid bytes in the packet. includes protocol/version/group fields, excluding the length field itself.
      Version       : UInt8 := 0; -- Protocol version code.
      Group         : UInt8 := 0; -- ID of the group to which this packet belongs.
      Protocol      : UInt8 := 0; -- Inner protocol number c.f. those issued by IANA for IP protocols
      Payload       : Payload_Data := (0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0); --32 which is the max packet size
      RSSI          : UInt7 := 0;
   end record;

   subtype Radio_Address is UInt32;

   --  Configure the radio for basic RF operations
   procedure Setup_For_RF_nrf52 (Frequency: Radio_Frequency_MHz;
                                 Mode : Radio_Mode;
                                 Power: Radio_Power;
                                 Base0Address : Radio_Address;
                                 Group: Radio_Group)
       with Pre => IsInitialized = FALSE;

  function IsInitialized return Boolean;

  function DataReady return Boolean;

  function Get_SafeFramebuffer return Framebuffer;

  procedure Set_QueueDepth(newDepth : UInt8);

  function Get_QueueDepth return UInt8;

  procedure DeepCopyIntoSafeFramebuffer;

  function Get_RSSIsample return  UInt7;

  procedure Set_RSSI (rssi_value : UInt7)
    with Pre => IsInitialized;

   function Get_RSSI return UInt7
      with Pre => IsInitialized;

   type RxQueueArray is array (0 .. MICROBIT_RADIO_MAXIMUM_RX_BUFFERS) of Framebuffer;

   RxBuf         : Framebuffer;
   TxBuf         : Framebuffer;
   RxQueue       : RxQueueArray;
private
   IsInit        : Boolean := FALSE;
   Group         : Radio_Group;
   rssi          : UInt7;
   QueueDepth    : Uint8 := 0;
   SafeFramebuffer  : Framebuffer; --is it really safe though as technically we can still write to RXBuf
                                   --while reading and copying to Safeframebuffer since we dont use locks/semaphores/barriers
                                   --this could for example happen when we are receiving more packages than we can process,
                                   --thus overwriting the last framebuffer in the queue while potentailly reading and copying from it



   procedure Set_Nrf52FastRampup;

   for Radio_State use (Disabled    => 0,
                        Rx_Ramp_Up  => 1,
                        Rx_Idle     => 2,
                        Rx_State    => 3,
                        Rx_Disabled => 4,
                        Tx_Ramp_Up  => 9,
                        Tx_Idle     => 10,
                        Tx_State    => 11,
                        Tx_Disabled => 12);

   for Radio_Power use (Zero_Dbm   => 16#00#,
                        Pos_4_Dbm  => 16#04#,
                        Pos_8_Dbm  => 16#08#,
                        Neg_30_Dbm => 16#D8#,
                        Neg_20_Dbm => 16#EC#,
                        Neg_16_Dbm => 16#F0#,
                        Neg_12_Dbm => 16#F4#,
                        Neg_8_Dbm  => 16#F8#,
                        Neg_4_Dbm  => 16#FC#);




end nRF.Radio;
